/**
 * Incident derivation — purely from persisted check data, never from
 * fixtures/dataset_incident_log.json (see docs/data-audit.md §4 for why that
 * file is a test oracle, not a data source).
 *
 * Algorithm: for each service, take checkpoints that failed (valid status,
 * not success), sorted by time. Merge consecutive failures into one run when
 * the gap between them is small enough to still be "the same outage" (a
 * service can intermittently recover for a check or two mid-outage without
 * that meaning two separate incidents). A run must reach a minimum length to
 * be reported, so ordinary background errors don't become phantom incidents.
 *
 * These thresholds were chosen for sane general behavior and validated
 * against fixtures/dataset_incident_log.json as an external oracle — every
 * injected outage in all five files is recovered at the correct service, day
 * and starting check-point (see docs/data-audit.md §4 for the full
 * comparison, including the two honest discrepancies that were not tuned
 * away).
 */

import type { Checkpoint, DerivedIncident } from "./types.js";

/** Failures separated by up to this many *non-failing* checkpoints still count as one outage. */
const GAP_TOLERANCE_SLOTS = 3;
/** A run shorter than this is treated as background noise, not a reportable incident. */
const MIN_FAILED_SLOTS = 4;

function severityFor(failedChecks: number): DerivedIncident["severity"] {
  if (failedChecks >= 16) return "critical";
  if (failedChecks >= 8) return "major";
  return "minor";
}

export function deriveIncidents(checkpoints: Checkpoint[], intervalSeconds: number): DerivedIncident[] {
  const byService = new Map<string, Checkpoint[]>();
  for (const cp of checkpoints) {
    if (cp.isSuccess) continue;
    const arr = byService.get(cp.serviceId) ?? [];
    arr.push(cp);
    byService.set(cp.serviceId, arr);
  }

  const maxGapMs = intervalSeconds * 1000 * (GAP_TOLERANCE_SLOTS + 1);
  const incidents: DerivedIncident[] = [];

  for (const [serviceId, fails] of byService) {
    const sorted = [...fails].sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
    let run: Checkpoint[] = [sorted[0]!];

    const flush = () => {
      if (run.length >= MIN_FAILED_SLOTS) {
        const startedAt = run[0]!.checkedAt;
        const endedAt = run[run.length - 1]!.checkedAt;
        incidents.push({
          serviceId,
          startedAt,
          endedAt,
          failedChecks: run.length,
          durationMinutes: Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000),
          severity: severityFor(run.length),
        });
      }
    };

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (cur.checkedAt.getTime() - prev.checkedAt.getTime() <= maxGapMs) {
        run.push(cur);
      } else {
        flush();
        run = [cur];
      }
    }
    flush();
  }

  return incidents.sort((a, b) => b.failedChecks - a.failedChecks);
}
