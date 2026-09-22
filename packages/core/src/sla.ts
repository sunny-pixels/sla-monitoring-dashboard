/**
 * SLA math — the exact rule from docs/data-audit.md §5, implemented once
 * here (mirrored in SQL by get_sla_stats() in database/schema.sql for live
 * queries; this copy exists so the rule can be unit-tested against the
 * fixtures without a database, and so the Worker can compute a summary
 * immediately after each upload).
 *
 * Unit of measurement: one check-point = one (service, inferred interval).
 * The interval is inferred from the data (I2/§5), never hardcoded, so the
 * app works on a CSV of any cadence or duration.
 */

import type { CleanedCheck, Checkpoint, SlaStats } from "./types.js";

/**
 * Infers the monitoring interval in seconds from the modal gap between
 * consecutive timestamps for a single service. Falls back to 900s (15 min,
 * the cadence observed in every supplied fixture) when fewer than two
 * distinct timestamps are available to measure a gap from.
 */
export function inferIntervalSeconds(checks: CleanedCheck[]): number {
  const byService = new Map<string, number[]>();
  for (const c of checks) {
    const arr = byService.get(c.serviceId) ?? [];
    arr.push(c.checkedAt.getTime());
    byService.set(c.serviceId, arr);
  }

  const gapCounts = new Map<number, number>();
  for (const times of byService.values()) {
    const unique = [...new Set(times)].sort((a, b) => a - b);
    for (let i = 1; i < unique.length; i++) {
      const gapSec = Math.round((unique[i]! - unique[i - 1]!) / 1000);
      if (gapSec > 0) gapCounts.set(gapSec, (gapCounts.get(gapSec) ?? 0) + 1);
    }
  }

  if (gapCounts.size === 0) return 900;

  let modeGap = 900;
  let modeCount = -1;
  for (const [gap, count] of gapCounts) {
    if (count > modeCount) {
      modeGap = gap;
      modeCount = count;
    }
  }
  return modeGap;
}

/**
 * Collapses possibly-multiple observations per (service, checkedAt) into one
 * checkpoint outcome. Worst (highest) status code among *valid* observations
 * wins (I2, I3) — a failure seen by any agent is evidence of failure. A
 * checkpoint whose only observation(s) are invalid (e.g. status 999) yields
 * no entry at all, which correctly excludes it from both the numerator and
 * denominator while still letting coverage calculations see it as unresolved.
 */
export function collapseToCheckpoints(checks: CleanedCheck[]): Checkpoint[] {
  const bestByKey = new Map<string, Checkpoint>();

  for (const c of checks) {
    if (!c.statusValid) continue; // I3: invalid status never becomes a checkpoint outcome
    const key = `${c.serviceId}|${c.checkedAt.getTime()}`;
    const existing = bestByKey.get(key);
    if (!existing || c.statusCode > existing.statusCode) {
      bestByKey.set(key, {
        serviceId: c.serviceId,
        checkedAt: c.checkedAt,
        statusCode: c.statusCode,
        isSuccess: c.isSuccess,
        latencyMs: c.latencyMs,
      });
    }
  }

  return [...bestByKey.values()].sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Full SLA statistics computed from a set of cleaned checks (optionally
 * pre-filtered to a date range by the caller). Coverage compares observed
 * valid checkpoints against the expected grid size for the given range —
 * missing checkpoints are never treated as successful (§5).
 */
export function computeSlaStats(checks: CleanedCheck[]): SlaStats {
  const intervalSeconds = checks.length > 0 ? inferIntervalSeconds(checks) : null;
  const checkpoints = collapseToCheckpoints(checks);

  const services = new Set(checkpoints.map((c) => c.serviceId));
  const successful = checkpoints.filter((c) => c.isSuccess);
  const failed = checkpoints.filter((c) => !c.isSuccess);

  const times = checkpoints.map((c) => c.checkedAt.getTime());
  const rangeStart = times.length ? new Date(Math.min(...times)) : null;
  const rangeEnd = times.length ? new Date(Math.max(...times)) : null;

  let expectedCheckpoints = 0;
  if (rangeStart && rangeEnd && intervalSeconds) {
    const slots = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (intervalSeconds * 1000)) + 1;
    expectedCheckpoints = slots * services.size;
  }

  const latencies = checkpoints
    .map((c) => c.latencyMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const perService = [...services].sort().map((serviceId) => {
    const svcCheckpoints = checkpoints.filter((c) => c.serviceId === serviceId);
    const svcSuccess = svcCheckpoints.filter((c) => c.isSuccess);
    const svcLatencies = svcCheckpoints
      .map((c) => c.latencyMs)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    return {
      serviceId,
      validCheckpoints: svcCheckpoints.length,
      successfulCheckpoints: svcSuccess.length,
      availabilityPct: svcCheckpoints.length
        ? round((100 * svcSuccess.length) / svcCheckpoints.length, 4)
        : null,
      latencyAvgMs: svcLatencies.length
        ? round(svcLatencies.reduce((a, b) => a + b, 0) / svcLatencies.length, 1)
        : null,
      latencyP95Ms: svcLatencies.length ? round(percentile(svcLatencies, 0.95)!, 1) : null,
    };
  });

  return {
    validCheckpoints: checkpoints.length,
    successfulCheckpoints: successful.length,
    failedCheckpoints: failed.length,
    availabilityPct: checkpoints.length ? round((100 * successful.length) / checkpoints.length, 4) : null,
    expectedCheckpoints,
    coveragePct: expectedCheckpoints > 0 ? round((100 * checkpoints.length) / expectedCheckpoints, 4) : null,
    latency: {
      samples: latencies.length,
      avgMs: latencies.length ? round(latencies.reduce((a, b) => a + b, 0) / latencies.length, 1) : null,
      p50Ms: latencies.length ? round(percentile(latencies, 0.5)!, 1) : null,
      p95Ms: latencies.length ? round(percentile(latencies, 0.95)!, 1) : null,
      p99Ms: latencies.length ? round(percentile(latencies, 0.99)!, 1) : null,
    },
    rangeStart,
    rangeEnd,
    servicesMonitored: services.size,
    intervalSeconds,
    perService,
  };
}
