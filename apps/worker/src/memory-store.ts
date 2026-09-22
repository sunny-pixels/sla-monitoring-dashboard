/**
 * LOCAL-DEV-ONLY placeholder store — see the warning in store.ts. Lives in
 * module-scope memory for the lifetime of the `wrangler dev` process; data
 * is lost on restart. This exists so the upload/dashboard flow can be built
 * and verified end-to-end in the browser before a Supabase project exists.
 * It implements the exact same Store interface SupabaseStore will, so
 * swapping is a one-line change in index.ts.
 */

import {
  collapseToCheckpoints,
  computeDailyAvailability,
  computeSlaStats,
  deriveIncidents,
  inferIntervalSeconds,
  type CleanedCheck,
} from "@sla/core";
import type { LogCheckRecord, LogsQuery, Store, StatsQuery, UploadRecord } from "./store.js";

interface UploadState {
  record: UploadRecord;
  checks: LogCheckRecord[];
  nextId: number;
  /**
   * Index of `checks` by the observer key (service, checked-at, agent),
   * maintained across ALL chunks of this upload — not just within one. This
   * is what a Postgres `UNIQUE (upload_id, service_id, checked_at, agent)`
   * constraint plus an `ON CONFLICT ... DO UPDATE` upsert gives you for free
   * in the real store; the in-memory placeholder has to do it by hand.
   */
  indexByObserverKey: Map<string, number>;
}

function observerKey(c: CleanedCheck): string {
  return `${c.serviceId}|${c.checkedAt.getTime()}|${c.agent}`;
}

/**
 * True when two checks at the same observer key are a genuine byte-exact
 * duplicate (I6a) rather than merely resolving to the same instant. Compares
 * `checkedAtRaw` too — a `...Z` row and its `+05:30` equivalent share an
 * observer key after normalization but are NOT byte-exact, and must be
 * categorized as an I6b conflict instead (see the real 9d fixture example
 * this guards against, documented on CleanedCheck.checkedAtRaw).
 */
function isSameObservation(a: CleanedCheck, b: CleanedCheck): boolean {
  return (
    a.checkedAtRaw.trim() === b.checkedAtRaw.trim() &&
    a.statusCode === b.statusCode &&
    a.latencyRaw.trim() === b.latencyRaw.trim() &&
    a.latencyUnit.trim().toLowerCase() === b.latencyUnit.trim().toLowerCase() &&
    a.region === b.region
  );
}

function isMoreComplete(a: CleanedCheck, b: CleanedCheck): boolean {
  return (a.latencyMs !== null ? 1 : 0) > (b.latencyMs !== null ? 1 : 0);
}

const uploads = new Map<string, UploadState>();

function inRange(check: CleanedCheck, from?: Date, to?: Date): boolean {
  const t = check.checkedAt.getTime();
  if (from && t < from.getTime()) return false;
  if (to && t >= to.getTime()) return false;
  return true;
}

export function createMemoryStore(): Store {
  return {
    async createUpload({ filename, fileSizeBytes }) {
      const id = crypto.randomUUID();
      const record: UploadRecord = {
        id,
        filename,
        fileSizeBytes,
        status: "processing",
        rowsReceived: 0,
        rowsAccepted: 0,
        rowsRejected: 0,
        exactDuplicatesRemoved: 0,
        observerDuplicatesResolved: 0,
        qualityIssues: [],
        intervalSeconds: null,
        rangeStart: null,
        rangeEnd: null,
        createdAt: new Date(),
        completedAt: null,
      };
      uploads.set(id, { record, checks: [], nextId: 0, indexByObserverKey: new Map() });
      return record;
    },

    async appendChunk(uploadId, chunk) {
      const state = uploads.get(uploadId);
      if (!state) throw new Error(`Unknown uploadId: ${uploadId}`);

      // Reconcile against every check already stored from EARLIER chunks of
      // this same upload, not just within this chunk — @sla/core's dedup
      // only sees one chunk at a time, so a duplicate whose twin landed in a
      // different chunk would otherwise slip through both classes of I6.
      let crossChunkExact = 0;
      let crossChunkConflicts = 0;

      for (const check of chunk.cleaned) {
        const key = observerKey(check);
        const existingIdx = state.indexByObserverKey.get(key);

        if (existingIdx === undefined) {
          state.checks.push({ ...check, id: `${uploadId}:${state.nextId++}` });
          state.indexByObserverKey.set(key, state.checks.length - 1);
          continue;
        }

        const existing = state.checks[existingIdx]!;
        if (isSameObservation(existing, check)) {
          crossChunkExact++; // I6a: byte-exact duplicate split across chunk boundaries
          continue;
        }
        crossChunkConflicts++; // I6b: conflicting duplicate split across chunk boundaries
        if (isMoreComplete(check, existing)) {
          state.checks[existingIdx] = { ...check, id: existing.id };
        }
        // else: keep the existing (more complete, or first-arrival on a tie)
      }

      state.record.rowsReceived += chunk.rowsReceived;
      state.record.rowsRejected += chunk.rejected.length;
      state.record.exactDuplicatesRemoved += chunk.exactDuplicatesRemoved + crossChunkExact;
      state.record.observerDuplicatesResolved += chunk.observerDuplicatesResolved + crossChunkConflicts;

      // Merge per-chunk quality issue counts by code, PLUS the cross-chunk
      // counts detected above — otherwise a duplicate pair split across a
      // chunk boundary would be reflected in the numeric summary counters
      // but silently missing from the itemized quality-issue breakdown.
      const merged = new Map(state.record.qualityIssues.map((i) => [i.code, { ...i }]));
      const bump = (code: (typeof chunk.issues)[number]["code"], count: number, severity: "info" | "warning") => {
        if (count <= 0) return;
        const existing = merged.get(code);
        if (existing) existing.count += count;
        else merged.set(code, { code, count, severity });
      };
      for (const issue of chunk.issues) bump(issue.code, issue.count, issue.severity);
      bump("EXACT_DUPLICATE_REMOVED", crossChunkExact, "info");
      bump("OBSERVER_CONFLICT_RESOLVED", crossChunkConflicts, "info");
      state.record.qualityIssues = [...merged.values()];
    },

    async finalizeUpload(uploadId) {
      const state = uploads.get(uploadId);
      if (!state) throw new Error(`Unknown uploadId: ${uploadId}`);

      state.record.rowsAccepted = state.checks.length;
      state.record.intervalSeconds = state.checks.length ? inferIntervalSeconds(state.checks) : null;
      const times = state.checks.map((c) => c.checkedAt.getTime());
      state.record.rangeStart = times.length ? new Date(Math.min(...times)) : null;
      state.record.rangeEnd = times.length ? new Date(Math.max(...times)) : null;
      state.record.status = "completed";
      state.record.completedAt = new Date();

      return state.record;
    },

    async listUploads() {
      return [...uploads.values()]
        .map((s) => s.record)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async getUpload(uploadId) {
      return uploads.get(uploadId)?.record ?? null;
    },

    async getStats(uploadId, query: StatsQuery) {
      const state = uploads.get(uploadId);
      if (!state) return null;

      const from = query.from ? new Date(query.from) : undefined;
      const to = query.to ? new Date(query.to) : undefined;
      const scoped = state.checks.filter((c) => inRange(c, from, to));

      const stats = computeSlaStats(scoped);
      const checkpoints = collapseToCheckpoints(scoped);
      const incidents = deriveIncidents(checkpoints, stats.intervalSeconds ?? 900);
      const dailyAvailability = computeDailyAvailability(checkpoints);

      return { stats, incidents, dailyAvailability };
    },

    async getLogs(uploadId, query: LogsQuery) {
      const state = uploads.get(uploadId);
      if (!state) return null;

      let from: Date | undefined;
      let to: Date | undefined;
      if (query.date) {
        from = new Date(`${query.date}T00:00:00.000Z`);
        to = new Date(`${query.date}T00:00:00.000Z`);
        to.setUTCDate(to.getUTCDate() + 1);
      } else {
        from = query.from ? new Date(query.from) : undefined;
        to = query.to ? new Date(query.to) : undefined;
      }

      let filtered = state.checks.filter((c) => inRange(c, from, to));
      if (query.service) filtered = filtered.filter((c) => c.serviceId === query.service);
      if (query.status === "success") filtered = filtered.filter((c) => c.isSuccess);
      else if (query.status === "failed") filtered = filtered.filter((c) => c.statusValid && !c.isSuccess);
      else if (query.status === "invalid") filtered = filtered.filter((c) => !c.statusValid);

      filtered.sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());

      const total = filtered.length;
      const start = (query.page - 1) * query.pageSize;
      const data = filtered.slice(start, start + query.pageSize);

      return { data, total };
    },
  };
}
