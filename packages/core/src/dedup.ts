/**
 * Observer-level duplicate resolution — the second half of I6
 * (docs/data-audit.md §2). Byte-exact duplicates (I6a) are removed earlier,
 * directly on the raw CSV text in process.ts, matching the audit's own
 * textual-duplicate methodology (two rows are "byte-exact" only if their raw
 * fields match verbatim — including timestamp *text* — not merely the
 * instant they resolve to).
 *
 * What remains here is class (b): rows sharing the same
 * (service, resolved instant, agent) — the same logical observation — with
 * *conflicting* values, typically because one copy is missing its latency.
 * The more complete row wins. Class (c) — same slot, DIFFERENT agent — is
 * deliberately left untouched; it is not a duplicate, it is a second
 * observer, and is only collapsed at calculation time in sla.ts (I2).
 *
 * This resolution is applied per upload chunk; a class-(b) conflict whose
 * two rows land in different chunks is resolved by first-arrival instead of
 * completeness — a documented, bounded limitation (at most ~2 rows per file
 * in the supplied fixtures, affecting only latency, never status code).
 */

import type { CleanedCheck } from "./types.js";

export interface DedupResult {
  deduped: CleanedCheck[];
  observerDuplicatesResolved: number;
}

function observerKey(c: CleanedCheck): string {
  return [c.serviceId, c.checkedAt.getTime(), c.agent].join("|");
}

/** A row with a populated, usable latency is considered more "complete" than one without. */
function completeness(c: CleanedCheck): number {
  return c.latencyMs !== null ? 1 : 0;
}

export function resolveObserverConflicts(checks: CleanedCheck[]): DedupResult {
  const bestByObserver = new Map<string, CleanedCheck>();
  const order = new Map<string, number>();
  let observerDuplicatesResolved = 0;

  checks.forEach((c, i) => {
    const key = observerKey(c);
    const existing = bestByObserver.get(key);
    if (!existing) {
      bestByObserver.set(key, c);
      order.set(key, i);
      return;
    }
    observerDuplicatesResolved++;
    if (completeness(c) > completeness(existing)) {
      bestByObserver.set(key, c);
      order.set(key, i);
    }
    // else: keep existing (first-arrival wins ties)
  });

  const deduped = [...order.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => bestByObserver.get(key)!);

  return { deduped, observerDuplicatesResolved };
}
