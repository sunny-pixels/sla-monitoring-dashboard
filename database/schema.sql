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
-- docs/data-audit.md §5), then aggregates everything the dashboard needs —
-- availability, coverage, per-service breakdown, the daily availability
-- strip, and (from the `incidents` table, computed once at finalize time
-- rather than on every stats call) the derived incident list — in SQL,
-- rather than shipping thousands of rows to the Worker on every request.
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
  with upload_meta as (
    select coalesce(interval_seconds, 900) as interval_seconds
    from uploads where id = p_upload_id
  ),
  scoped as (
    select *
    from health_checks
    where upload_id = p_upload_id
      and (p_from is null or checked_at >= p_from)
      and (p_to   is null or checked_at <  p_to)
  ),
  -- Collapse to one outcome per (service, check-point): worst status among
  -- VALID observations wins. Invalid rows (e.g. status 999, I3) are excluded
  -- before collapsing — a checkpoint whose only observation(s) are invalid
  -- yields no row here at all, correctly dropping out of both the numerator
  -- and denominator while still being visible as reduced coverage.
  checkpoints as (
    select distinct on (service_id, checked_at)
      service_id, checked_at, status_code, is_success, latency_ms
    from scoped
    where status_valid
    order by service_id, checked_at, status_code desc
  ),
  overall as (
    select
      count(*)                                     as valid_checkpoints,
      count(*) filter (where is_success)            as successful_checkpoints,
      count(*) filter (where not is_success)        as failed_checkpoints,
      count(*) filter (where latency_ms is not null) as latency_samples,
      percentile_cont(0.5)  within group (order by latency_ms) as latency_p50,
      percentile_cont(0.95) within group (order by latency_ms) as latency_p95,
      percentile_cont(0.99) within group (order by latency_ms) as latency_p99,
      avg(latency_ms)                                as latency_avg,
      min(checked_at)                                as range_start,
      max(checked_at)                                as range_end,
      count(distinct service_id)                     as services_monitored
    from checkpoints
  ),
  per_service as (
    select
      service_id,
      count(*)                              as valid_checkpoints,
      count(*) filter (where is_success)    as successful_checkpoints,
      avg(latency_ms)                       as latency_avg,
      percentile_cont(0.95) within group (order by latency_ms) as latency_p95
    from checkpoints
    group by service_id
  ),
  -- Per-UTC-day availability for the "where do the outages fall" bar strip —
  -- mirrors packages/core's computeDailyAvailability() (sla.ts).
  daily as (
    select
      (checked_at at time zone 'UTC')::date as day,
      count(*)                        as valid_checkpoints,
      count(*) filter (where is_success) as successful
    from checkpoints
    group by 1
  ),
  incidents_scoped as (
    select service_id, started_at, ended_at, failed_checks, duration_minutes, severity
    from incidents
    where upload_id = p_upload_id
      and (p_from is null or started_at >= p_from)
      and (p_to   is null or started_at <  p_to)
  )
  select jsonb_build_object(
    'validCheckpoints',      o.valid_checkpoints,
    'successfulCheckpoints', o.successful_checkpoints,
    'failedCheckpoints',     o.failed_checkpoints,
    'availabilityPct',
      case when o.valid_checkpoints > 0
           then round(100.0 * o.successful_checkpoints / o.valid_checkpoints, 4)
           else null end,
    'expectedCheckpoints', coalesce(expected.expected_checkpoints, 0),
    'coveragePct',
      case when coalesce(expected.expected_checkpoints, 0) > 0
           then round(100.0 * o.valid_checkpoints / expected.expected_checkpoints, 4)
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
    'rangeStart',        o.range_start,
    'rangeEnd',          o.range_end,
    'servicesMonitored', o.services_monitored,
    'intervalSeconds',   um.interval_seconds,
    'perService', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'serviceId',             ps.service_id,
        'validCheckpoints',      ps.valid_checkpoints,
        'successfulCheckpoints', ps.successful_checkpoints,
        'availabilityPct',
          round(100.0 * ps.successful_checkpoints / nullif(ps.valid_checkpoints, 0), 4),
        'latencyAvgMs', round(ps.latency_avg::numeric, 1),
        'latencyP95Ms', round(ps.latency_p95::numeric, 1)
      ) order by ps.service_id), '[]'::jsonb)
      from per_service ps
    ),
    'dailyAvailability', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'availabilityPct',
          case when d.valid_checkpoints > 0
               then round(100.0 * d.successful / d.valid_checkpoints, 2)
               else null end,
        'validCheckpoints', d.valid_checkpoints
      ) order by d.day), '[]'::jsonb)
      from daily d
    ),
    'incidents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'serviceId',       i.service_id,
        'startedAt',       i.started_at,
        'endedAt',         i.ended_at,
        'failedChecks',    i.failed_checks,
        'durationMinutes', i.duration_minutes,
        'severity',        i.severity
      ) order by i.failed_checks desc), '[]'::jsonb)
      from incidents_scoped i
    )
  )
  from overall o
  cross join upload_meta um
  cross join lateral (
    select case
             when o.range_start is not null and o.range_end is not null and um.interval_seconds > 0
             then (floor(extract(epoch from (o.range_end - o.range_start)) / um.interval_seconds) + 1)
                    * o.services_monitored
             else 0
           end as expected_checkpoints
  ) expected;
$$;

comment on function get_sla_stats is
  'Aggregates health_checks (plus the precomputed incidents table) for the '
  'dashboard stats panel in one round trip: availability, coverage, latency '
  'percentiles, per-service breakdown, daily availability, and incidents — '
  'per the check-point-based SLA definition in docs/data-audit.md §5.';

-- ═══════════════════════════════════════════════════════════════════════════
-- bump_upload_counters: called once per uploaded chunk. Accumulates the
-- running rowsReceived/rowsRejected/duplicate counters and merges that
-- chunk's quality-issue counts into uploads.quality_issues — atomically,
-- so sequential chunk uploads (the only pattern this app produces) can
-- never race each other or lose an update.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function bump_upload_counters(
  p_upload_id           uuid,
  p_rows_received       int,
  p_rows_rejected       int,
  p_exact_duplicates    int,
  p_observer_duplicates int,
  p_quality_issues      jsonb  -- this chunk's [{code,count,severity,example?}, ...]
)
returns void
language plpgsql
as $$
declare
  v_existing jsonb;
  v_merged   jsonb;
begin
  select quality_issues into v_existing from uploads where id = p_upload_id for update;

  select coalesce(jsonb_agg(
           jsonb_build_object('code', code, 'count', total, 'severity', severity, 'example', example)
           order by code
         ), '[]'::jsonb)
  into v_merged
  from (
    select
      elem->>'code' as code,
      sum((elem->>'count')::int) as total,
      (array_agg(elem->>'severity'))[1] as severity,
      (array_agg(elem->>'example') filter (where elem->>'example' is not null))[1] as example
    from jsonb_array_elements(coalesce(v_existing, '[]'::jsonb) || coalesce(p_quality_issues, '[]'::jsonb)) as elem
    group by elem->>'code'
  ) merged;

  update uploads
  set rows_received                = rows_received + p_rows_received,
      rows_rejected                = rows_rejected + p_rows_rejected,
      exact_duplicates_removed     = exact_duplicates_removed + p_exact_duplicates,
      observer_duplicates_resolved = observer_duplicates_resolved + p_observer_duplicates,
      quality_issues               = v_merged
  where id = p_upload_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- finalize_upload: called once after all chunks of an upload have been
-- persisted. Computes the fields that can only be known once every row is
-- in (accepted-row count, actual date range, inferred cadence), reconciles
-- the duplicate counters against reality, marks the upload completed, and
-- derives incidents from the persisted data — never from the seed
-- fixtures' answer-key JSON (see docs/data-audit.md §4).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function finalize_upload(p_upload_id uuid)
returns void
language plpgsql
as $$
declare
  v_row_count       bigint;
  v_range_start     timestamptz;
  v_range_end       timestamptz;
  v_interval        int;
  v_rows_received   int;
  v_exact           int;
  v_observer        int;
  v_residual        int;
begin
  select count(*), min(checked_at), max(checked_at)
    into v_row_count, v_range_start, v_range_end
  from health_checks
  where upload_id = p_upload_id;

  -- Cadence inferred from the data itself (modal positive gap between
  -- consecutive checks per service) — never hardcoded, mirrors
  -- packages/core's inferIntervalSeconds() (sla.ts).
  select coalesce(mode() within group (order by gap_seconds), 900)
    into v_interval
  from (
    select
      extract(epoch from (
        checked_at - lag(checked_at) over (partition by service_id order by checked_at)
      ))::int as gap_seconds
    from health_checks
    where upload_id = p_upload_id
  ) g
  where gap_seconds > 0;

  select rows_received, exact_duplicates_removed, observer_duplicates_resolved
    into v_rows_received, v_exact, v_observer
  from uploads where id = p_upload_id;

  -- I6a/I6b duplicates split across a chunk boundary are removed correctly
  -- by the UNIQUE constraint + upsert (data is always correct), but aren't
  -- individually countable after the fact without extra bookkeeping this
  -- schema doesn't keep. The residual — whatever duplicate count the
  -- per-chunk counters didn't already account for — is folded into
  -- observer_duplicates_resolved. Documented, bounded (a handful of rows at
  -- most per upload), and never affects rows_accepted or SLA correctness —
  -- see the equivalent, more precisely-categorized handling in
  -- apps/worker/src/memory-store.ts for the in-memory store.
  v_residual := greatest(0, coalesce(v_rows_received, 0) - coalesce(v_row_count, 0)
                             - coalesce(v_exact, 0) - coalesce(v_observer, 0));

  update uploads
  set rows_accepted                = v_row_count,
      range_start                  = v_range_start,
      range_end                    = v_range_end,
      interval_seconds             = v_interval,
      observer_duplicates_resolved = observer_duplicates_resolved + v_residual,
      status                       = 'completed',
      completed_at                 = now()
  where id = p_upload_id;

  -- Idempotent: safe if finalize is ever called twice for the same upload.
  delete from incidents where upload_id = p_upload_id;

  insert into incidents (upload_id, service_id, started_at, ended_at, failed_checks, duration_minutes, severity)
  select
    p_upload_id,
    service_id,
    min(checked_at) as started_at,
    max(checked_at) as ended_at,
    count(*) as failed_checks,
    round(extract(epoch from (max(checked_at) - min(checked_at))) / 60)::int as duration_minutes,
    case when count(*) >= 16 then 'critical' when count(*) >= 8 then 'major' else 'minor' end as severity
  from (
    -- Consecutive failed check-points per service, merging runs separated
    -- by a gap of up to 3 non-failing slots (GAP_TOLERANCE_SLOTS in
    -- packages/core/incidents.ts — kept in sync with that constant).
    select
      service_id, checked_at,
      sum(case when gap_seconds is null or gap_seconds > v_interval * 4 then 1 else 0 end)
        over (partition by service_id order by checked_at) as run_id
    from (
      select
        service_id, checked_at,
        extract(epoch from (
          checked_at - lag(checked_at) over (partition by service_id order by checked_at)
        ))::int as gap_seconds
      from (
        select distinct on (service_id, checked_at)
          service_id, checked_at, is_success
        from health_checks
        where upload_id = p_upload_id and status_valid
        order by service_id, checked_at, status_code desc
      ) checkpoints
      where not is_success
    ) fails_with_gap
  ) grouped
  group by service_id, run_id
  having count(*) >= 4;  -- MIN_FAILED_SLOTS in packages/core/incidents.ts
end;
$$;

comment on function finalize_upload is
  'Called once after the last chunk of an upload is persisted. Computes '
  'rows_accepted/range/cadence from the final data, reconciles duplicate '
  'counters, and derives incidents into the incidents table — see '
  'docs/data-audit.md §5 for the SLA rule and §4 for why incidents are '
  'never sourced from the seed fixtures'' answer-key JSON.';
