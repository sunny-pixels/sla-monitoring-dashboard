/**
 * The real persistence layer — Postgres via Supabase, matching
 * database/schema.sql. Implements the exact same Store interface as
 * MemoryStore (store.ts), so index.ts doesn't need to know which one it's
 * talking to.
 *
 * Design mirrors what MemoryStore does in JS, but pushed into SQL:
 *   - appendChunk() upserts rows keyed on the same
 *     (upload_id, service_id, checked_at, agent) tuple as the UNIQUE
 *     constraint, so a duplicate split across a chunk boundary is resolved
 *     by the database itself (last-write-wins on conflict) rather than by
 *     hand-rolled JS bookkeeping — see database/schema.sql's comments on
 *     finalize_upload() for the one place this trades precision for
 *     simplicity (the cross-chunk exact/conflict split is folded into a
 *     single "observer resolved" residual rather than categorized exactly).
 *   - getStats() calls the get_sla_stats() SQL function: one round trip,
 *     computed in the database, never hauling thousands of rows to the
 *     Worker just to sum them.
 *   - getLogs() is genuine server-side pagination via Postgres LIMIT/OFFSET
 *     (.range()), not a fetch-everything-then-slice.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CleanedCheck, DerivedIncident, QualityIssue, RejectedRow } from "@sla/core";
import type { DailyAvailability, LogCheckRecord, LogsQuery, Store, StatsQuery, UploadRecord } from "./store.js";

interface UploadRow {
  id: string;
  filename: string;
  file_size_bytes: number;
  status: "processing" | "completed" | "failed";
  rows_received: number;
  rows_accepted: number;
  rows_rejected: number;
  exact_duplicates_removed: number;
  observer_duplicates_resolved: number;
  interval_seconds: number | null;
  range_start: string | null;
  range_end: string | null;
  quality_issues: QualityIssue[];
  created_at: string;
  completed_at: string | null;
}

interface HealthCheckRow {
  id: number;
  service_id: string;
  service_name: string;
  checked_at: string;
  status_code: number;
  status_valid: boolean;
  is_success: boolean;
  latency_ms: number | null;
  latency_raw: string | null;
  latency_unit: string | null;
  agent: string;
  region: string;
}

function toUploadRecord(row: UploadRow): UploadRecord {
  return {
    id: row.id,
    filename: row.filename,
    fileSizeBytes: row.file_size_bytes,
    status: row.status,
    rowsReceived: row.rows_received,
    rowsAccepted: row.rows_accepted,
    rowsRejected: row.rows_rejected,
    exactDuplicatesRemoved: row.exact_duplicates_removed,
    observerDuplicatesResolved: row.observer_duplicates_resolved,
    qualityIssues: row.quality_issues ?? [],
    intervalSeconds: row.interval_seconds,
    rangeStart: row.range_start ? new Date(row.range_start) : null,
    rangeEnd: row.range_end ? new Date(row.range_end) : null,
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

/** Reconstructs a LogCheckRecord from a DB row. `checkedAtRaw` has no persisted
 * source of truth (see CleanedCheck.checkedAtRaw's doc comment) — it's only
 * ever consulted during chunk-time dedup, never after rows are read back, so
 * the ISO string stands in harmlessly here. */
function toLogCheckRecord(row: HealthCheckRow): LogCheckRecord {
  return {
    id: String(row.id),
    serviceId: row.service_id,
    serviceName: row.service_name,
    checkedAt: new Date(row.checked_at),
    checkedAtRaw: row.checked_at,
    statusCode: row.status_code,
    statusValid: row.status_valid,
    isSuccess: row.is_success,
    latencyMs: row.latency_ms,
    latencyRaw: row.latency_raw ?? "",
    latencyUnit: row.latency_unit ?? "",
    agent: row.agent,
    region: row.region,
  };
}

function toHealthCheckInsert(uploadId: string, c: CleanedCheck) {
  return {
    upload_id: uploadId,
    service_id: c.serviceId,
    service_name: c.serviceName,
    checked_at: c.checkedAt.toISOString(),
    status_code: c.statusCode,
    status_valid: c.statusValid,
    is_success: c.isSuccess,
    latency_ms: c.latencyMs,
    latency_raw: c.latencyRaw,
    latency_unit: c.latencyUnit,
    agent: c.agent,
    region: c.region,
  };
}

function toRejectedRowInsert(uploadId: string, r: RejectedRow) {
  return {
    upload_id: uploadId,
    line_no: r.lineNo,
    raw_line: r.rawLine,
    field: r.field,
    reason: r.reason,
  };
}

/** Shape returned by the get_sla_stats() SQL function — see database/schema.sql. */
interface SlaStatsRpcResult {
  validCheckpoints: number;
  successfulCheckpoints: number;
  failedCheckpoints: number;
  availabilityPct: number | null;
  expectedCheckpoints: number;
  coveragePct: number | null;
  latency: { samples: number; avgMs: number | null; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null };
  rangeStart: string | null;
  rangeEnd: string | null;
  servicesMonitored: number;
  intervalSeconds: number | null;
  perService: Array<{
    serviceId: string;
    validCheckpoints: number;
    successfulCheckpoints: number;
    availabilityPct: number | null;
    latencyAvgMs: number | null;
    latencyP95Ms: number | null;
  }>;
  dailyAvailability: DailyAvailability[];
  incidents: Array<{
    serviceId: string;
    startedAt: string;
    endedAt: string;
    failedChecks: number;
    durationMinutes: number;
    severity: "minor" | "major" | "critical";
  }>;
}

function throwIfError<T>(result: { data: T; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

export function createSupabaseStore(url: string, serviceRoleKey: string): Store {
  const supabase: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return {
    async createUpload({ filename, fileSizeBytes }) {
      const result = await supabase
        .from("uploads")
        .insert({ filename, file_size_bytes: fileSizeBytes })
        .select("*")
        .single();
      const row = throwIfError(result, "createUpload") as UploadRow;
      return toUploadRecord(row);
    },

    async appendChunk(uploadId, chunk) {
      if (chunk.cleaned.length > 0) {
        const rows = chunk.cleaned.map((c) => toHealthCheckInsert(uploadId, c));
        const result = await supabase
          .from("health_checks")
          .upsert(rows, { onConflict: "upload_id,service_id,checked_at,agent" });
        throwIfError(result, "appendChunk: upsert health_checks");
      }

      if (chunk.rejected.length > 0) {
        const rows = chunk.rejected.map((r) => toRejectedRowInsert(uploadId, r));
        const result = await supabase.from("rejected_rows").insert(rows);
        throwIfError(result, "appendChunk: insert rejected_rows");
      }

      const result = await supabase.rpc("bump_upload_counters", {
        p_upload_id: uploadId,
        p_rows_received: chunk.rowsReceived,
        p_rows_rejected: chunk.rejected.length,
        p_exact_duplicates: chunk.exactDuplicatesRemoved,
        p_observer_duplicates: chunk.observerDuplicatesResolved,
        p_quality_issues: chunk.issues,
      });
      throwIfError(result, "appendChunk: bump_upload_counters");
    },

    async finalizeUpload(uploadId) {
      const finalizeResult = await supabase.rpc("finalize_upload", { p_upload_id: uploadId });
      throwIfError(finalizeResult, "finalizeUpload: finalize_upload RPC");

      const result = await supabase.from("uploads").select("*").eq("id", uploadId).single();
      const row = throwIfError(result, "finalizeUpload: fetch updated upload") as UploadRow;
      return toUploadRecord(row);
    },

    async listUploads() {
      const result = await supabase.from("uploads").select("*").order("created_at", { ascending: false });
      const rows = throwIfError(result, "listUploads") as UploadRow[];
      return rows.map(toUploadRecord);
    },

    async getUpload(uploadId) {
      const result = await supabase.from("uploads").select("*").eq("id", uploadId).maybeSingle();
      const row = throwIfError(result, "getUpload") as UploadRow | null;
      return row ? toUploadRecord(row) : null;
    },

    async getStats(uploadId, query: StatsQuery) {
      const existing = await supabase.from("uploads").select("id").eq("id", uploadId).maybeSingle();
      if (!throwIfError(existing, "getStats: check upload exists")) return null;

      const result = await supabase.rpc("get_sla_stats", {
        p_upload_id: uploadId,
        p_from: query.from ?? null,
        p_to: query.to ?? null,
      });
      const r = throwIfError(result, "getStats: get_sla_stats RPC") as SlaStatsRpcResult;

      const stats = {
        validCheckpoints: r.validCheckpoints,
        successfulCheckpoints: r.successfulCheckpoints,
        failedCheckpoints: r.failedCheckpoints,
        availabilityPct: r.availabilityPct,
        expectedCheckpoints: r.expectedCheckpoints,
        coveragePct: r.coveragePct,
        latency: r.latency,
        rangeStart: r.rangeStart ? new Date(r.rangeStart) : null,
        rangeEnd: r.rangeEnd ? new Date(r.rangeEnd) : null,
        servicesMonitored: r.servicesMonitored,
        intervalSeconds: r.intervalSeconds,
        perService: r.perService ?? [],
      };

      const incidents: DerivedIncident[] = (r.incidents ?? []).map((i) => ({
        serviceId: i.serviceId,
        startedAt: new Date(i.startedAt),
        endedAt: new Date(i.endedAt),
        failedChecks: i.failedChecks,
        durationMinutes: i.durationMinutes,
        severity: i.severity,
      }));

      return { stats, incidents, dailyAvailability: r.dailyAvailability ?? [] };
    },

    async getLogs(uploadId, query: LogsQuery) {
      const existing = await supabase.from("uploads").select("id").eq("id", uploadId).maybeSingle();
      if (!throwIfError(existing, "getLogs: check upload exists")) return null;

      let q = supabase.from("health_checks").select("*", { count: "exact" }).eq("upload_id", uploadId);

      if (query.date) {
        const from = `${query.date}T00:00:00.000Z`;
        const to = new Date(from);
        to.setUTCDate(to.getUTCDate() + 1);
        q = q.gte("checked_at", from).lt("checked_at", to.toISOString());
      } else {
        if (query.from) q = q.gte("checked_at", query.from);
        if (query.to) q = q.lt("checked_at", query.to);
      }

      if (query.service) q = q.eq("service_id", query.service);
      if (query.status === "success") q = q.eq("is_success", true);
      else if (query.status === "failed") q = q.eq("status_valid", true).eq("is_success", false);
      else if (query.status === "invalid") q = q.eq("status_valid", false);

      const start = (query.page - 1) * query.pageSize;
      const result = await q.order("checked_at", { ascending: false }).range(start, start + query.pageSize - 1);
      const rows = throwIfError(result, "getLogs") as HealthCheckRow[];

      return { data: rows.map(toLogCheckRecord), total: result.count ?? 0 };
    },
  };
}
