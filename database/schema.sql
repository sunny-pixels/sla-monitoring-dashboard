-- ═══════════════════════════════════════════════════════════════════════════
-- SLA Monitoring Dashboard — Postgres schema (Supabase)
--
-- Apply via the Supabase SQL editor, or `psql "$DATABASE_URL" -f database/schema.sql`.
-- Idempotent: safe to re-run.
--
-- Design notes (see docs/data-audit.md for the data findings that drive these
-- choices):
--   * health_checks stores every accepted observation, including redundant
--     agent-2 observations (I2) — collapsing to one row per check-point
--     happens at query time in get_sla_stats(), not at storage time. This
--     preserves the evidence that resolved I3 (agent disagreement on `999`).
--   * The UNIQUE constraint on (upload_id, service_id, checked_at, agent) is
--     the database-level idempotency guard for chunked uploads (I6): a
--     retried chunk cannot double-insert.
--   * latency_ms is nullable because a valid availability observation can
--     have an unusable latency (I5 negative values, I7 missing values) —
--     the two facts are independent and must not be coupled.
--   * status_valid distinguishes "invalid probe" (I3, e.g. 999) from
--     "valid but failing" (5xx) — only the latter counts as SLA failure;
--     the former is excluded from the denominator entirely.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- uploads: one row per CSV ingested. The unit of "a dataset" in the UI.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists uploads (
  id                  uuid primary key default gen_random_uuid(),
  filename            text not null,
  file_size_bytes     bigint not null default 0,
  status              text not null default 'processing'
                        check (status in ('processing', 'completed', 'failed')),

  rows_received       integer not null default 0,
  rows_accepted       integer not null default 0,
  rows_rejected       integer not null default 0,
  exact_duplicates_removed     integer not null default 0,
  observer_duplicates_resolved integer not null default 0,

  -- inferred from the data itself — never hardcoded (see docs/data-audit.md §1)
  interval_seconds    integer,
  range_start         timestamptz,
  range_end           timestamptz,

  -- structured quality findings for this upload, e.g.
  -- [{"code":"TIMESTAMP_NORMALIZED_EPOCH","count":233,"severity":"info", ...}]
  quality_issues      jsonb not null default '[]'::jsonb,

  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index if not exists idx_uploads_created_at on uploads (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- health_checks: every accepted, cleaned observation.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists health_checks (
  id              bigint generated always as identity primary key,
  upload_id       uuid not null references uploads (id) on delete cascade,

  service_id      text not null,
  service_name    text not null,
  checked_at      timestamptz not null,        -- normalized to UTC (I1)

  status_code     smallint not null,
  status_valid    boolean not null,             -- false for out-of-range codes like 999 (I3)
  is_success      boolean not null,             -- true only when status_valid and 200<=code<400

  latency_ms      integer,                      -- normalized (I4); null when unusable (I5, I7)
  latency_raw     text,                         -- original value as-received, for traceability
  latency_unit    text,                         -- original unit as-received ('ms' | 's')

  agent           text not null,
  region          text not null,

  created_at      timestamptz not null default now(),

  constraint uq_health_check_observation
    unique (upload_id, service_id, checked_at, agent)
);

create index if not exists idx_health_checks_upload_time
  on health_checks (upload_id, checked_at);
create index if not exists idx_health_checks_upload_service
  on health_checks (upload_id, service_id);
create index if not exists idx_health_checks_upload_status
  on health_checks (upload_id, status_code);
create index if not exists idx_health_checks_upload_success
  on health_checks (upload_id, is_success);

-- ─────────────────────────────────────────────────────────────────────────
-- rejected_rows: nothing is silently discarded (see docs/data-audit.md §6).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists rejected_rows (
  id          bigint generated always as identity primary key,
  upload_id   uuid not null references uploads (id) on delete cascade,
  line_no     integer not null,
  raw_line    text not null,
  field       text,               -- which column failed validation, if identifiable
  reason      text not null,      -- machine-readable reason code
  created_at  timestamptz not null default now()
);

create index if not exists idx_rejected_rows_upload on rejected_rows (upload_id);

-- ─────────────────────────────────────────────────────────────────────────
-- incidents: derived from persisted health_checks at finalize time.
-- NEVER populated from fixtures/dataset_incident_log.json — see
-- docs/data-audit.md §4 for why that file is a test oracle, not a data source.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists incidents (
  id                bigint generated always as identity primary key,
  upload_id         uuid not null references uploads (id) on delete cascade,
  service_id        text not null,
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  failed_checks     integer not null,
  duration_minutes  integer not null,
  severity          text not null check (severity in ('minor', 'major', 'critical')),
  created_at        timestamptz not null default now()
);

create index if not exists idx_incidents_upload on incidents (upload_id, started_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- get_sla_stats: single round-trip aggregation for the dashboard's stats
-- section. Collapses multi-agent observations per check-point (I2) via
-- DISTINCT ON ... ORDER BY status_code DESC (worst observation wins, per
-- docs/data-audit.md §5), then aggregates in SQL rather than shipping rows
-- to the browser (performance requirement).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function get_sla_stats(
  p_upload_id uuid,
  p_from      timestamptz default null,
  p_to        timestamptz default null
)
returns jsonb
language sql
stable
as $$
  with scoped as (
    select *
    from health_checks
    where upload_id = p_upload_id
      and (p_from is null or checked_at >= p_from)
      and (p_to   is null or checked_at <  p_to)
  ),
  -- collapse to one outcome per (service, check-point): worst status wins
  checkpoints as (
    select distinct on (service_id, checked_at)
      service_id, checked_at, status_code, status_valid, is_success, latency_ms
    from scoped
    order by service_id, checked_at, status_code desc
  ),
  valid_cp as (
    select * from checkpoints where status_valid
  ),
  overall as (
    select
      count(*)                                   as valid_checkpoints,
      count(*) filter (where is_success)          as successful_checkpoints,
      count(*) filter (where not is_success)      as failed_checkpoints,
      count(*) filter (where latency_ms is not null) as latency_samples,
      percentile_cont(0.5)  within group (order by latency_ms) as latency_p50,
      percentile_cont(0.95) within group (order by latency_ms) as latency_p95,
      percentile_cont(0.99) within group (order by latency_ms) as latency_p99,
      avg(latency_ms)                              as latency_avg,
      min(checked_at)                              as range_start,
      max(checked_at)                              as range_end,
      count(distinct service_id)                   as services_monitored
    from valid_cp
  ),
  per_service as (
    select
      service_id,
      count(*)                              as valid_checkpoints,
      count(*) filter (where is_success)    as successful_checkpoints,
      avg(latency_ms)                       as latency_avg,
      percentile_cont(0.95) within group (order by latency_ms) as latency_p95
    from valid_cp
    group by service_id
  )
  select jsonb_build_object(
    'validCheckpoints',      o.valid_checkpoints,
    'successfulCheckpoints', o.successful_checkpoints,
    'failedCheckpoints',     o.failed_checkpoints,
    'availabilityPct',
      case when o.valid_checkpoints > 0
           then round(100.0 * o.successful_checkpoints / o.valid_checkpoints, 4)
           else null end,
    'latency', jsonb_build_object(
      'samples', o.latency_samples,
      -- percentile_cont() returns double precision, and Postgres has no
      -- round(double precision, integer) overload — only round(numeric, ..) —
      -- so every percentile/avg here is cast to numeric first.
      'avgMs',   round(o.latency_avg::numeric, 1),
      'p50Ms',   round(o.latency_p50::numeric, 1),
      'p95Ms',   round(o.latency_p95::numeric, 1),
      'p99Ms',   round(o.latency_p99::numeric, 1)
    ),
    'rangeStart',          o.range_start,
    'rangeEnd',            o.range_end,
    'servicesMonitored',   o.services_monitored,
    'perService', (
      select jsonb_agg(jsonb_build_object(
        'serviceId',             ps.service_id,
        'validCheckpoints',      ps.valid_checkpoints,
        'successfulCheckpoints', ps.successful_checkpoints,
        'availabilityPct',
          round(100.0 * ps.successful_checkpoints / nullif(ps.valid_checkpoints, 0), 4),
        'latencyAvgMs', round(ps.latency_avg::numeric, 1),
        'latencyP95Ms', round(ps.latency_p95::numeric, 1)
      ) order by ps.service_id)
      from per_service ps
    )
  )
  from overall o;
$$;

comment on function get_sla_stats is
  'Aggregates health_checks for the dashboard stats panel in one round trip. '
  'Collapses multi-agent duplicate observations per check-point (worst status wins) '
  'before computing availability, per the check-point-based SLA definition in docs/data-audit.md.';
