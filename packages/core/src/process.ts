/**
 * The single high-level entry point that turns raw CSV text into a
 * ProcessResult: parse -> validate -> clean -> dedupe. This is what the
 * Cloudflare Worker calls per uploaded chunk, and what the test suite calls
 * directly against the fixtures — the same code path, so a passing test is a
 * guarantee about what the deployed Worker does.
 *
 * Every row either becomes a CleanedCheck or a RejectedRow with a reason.
 * Nothing is silently discarded (docs/data-audit.md §6).
 */

import { parseDataLine, resolveHeader, splitCsvLine, splitLines } from "./csv.js";
import { resolveObserverConflicts } from "./dedup.js";
import { REQUIRED_COLUMNS, type ProcessResult, type QualityIssue, type QualityIssueCode, type RequiredColumn } from "./types.js";
import { validateAndCleanRow } from "./validate.js";

export class SchemaValidationError extends Error {
  constructor(public readonly missingColumns: RequiredColumn[]) {
    super(`CSV is missing required column(s): ${missingColumns.join(", ")}`);
    this.name = "SchemaValidationError";
  }
}

const ISSUE_SEVERITY: Record<QualityIssueCode, QualityIssue["severity"]> = {
  TIMESTAMP_NORMALIZED_OFFSET: "info",
  TIMESTAMP_NORMALIZED_EPOCH: "info",
  STATUS_CODE_INVALID: "warning",
  LATENCY_NEGATIVE: "warning",
  LATENCY_MISSING: "info",
  LATENCY_UNPARSEABLE: "warning",
  EXACT_DUPLICATE_REMOVED: "info",
  OBSERVER_CONFLICT_RESOLVED: "info",
};

/**
 * @param text Raw CSV text for one file or one self-contained upload chunk.
 *   Each chunk is expected to carry its own header line (see the chunked
 *   upload design in the plan) so this function never needs cross-chunk state.
 * @throws {SchemaValidationError} if the header is missing a required column —
 *   this is a whole-file rejection, distinct from a per-row rejection.
 */
export function processCsvText(text: string): ProcessResult {
  const lines = splitLines(text);
  if (lines.length === 0) {
    return {
      cleaned: [],
      rejected: [],
      issues: [],
      rowsReceived: 0,
      exactDuplicatesRemoved: 0,
      observerDuplicatesResolved: 0,
    };
  }

  const header = resolveHeader(lines[0]!);
  if (!header.ok) {
    throw new SchemaValidationError(header.missingColumns);
  }

  const expectedFieldCount = splitCsvLine(lines[0]!).length;

  const issueCounts = new Map<QualityIssueCode, { count: number; example?: string }>();
  const bumpIssue = (code: QualityIssueCode, example?: string) => {
    const existing = issueCounts.get(code);
    if (existing) existing.count++;
    else issueCounts.set(code, { count: 1, example });
  };

  const rejected: ProcessResult["rejected"] = [];
  const cleanedRaw: ProcessResult["cleaned"] = [];
  let rowsReceived = 0;
  let exactDuplicatesRemoved = 0;

  // I6a: byte-exact duplicates are detected on the RAW field text, before any
  // parsing or normalization — matching the audit's own textual-duplicate
  // methodology. Two rows whose timestamps are written differently but
  // resolve to the same instant are NOT byte-exact duplicates; that case is
  // instead handled by resolveObserverConflicts() below on parsed values.
  const seenRawKeys = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i]!;
    if (rawLine.trim() === "") continue; // blank lines are skipped, not counted as data rows
    rowsReceived++;
    const lineNo = i + 1; // 1-based, matching the file's actual line number

    const fields = splitCsvLine(rawLine);
    const row = parseDataLine(fields, header.columnIndex, expectedFieldCount);
    if (!row) {
      rejected.push({ lineNo, rawLine, field: null, reason: "MALFORMED_ROW" });
      continue;
    }

    const rawKey = REQUIRED_COLUMNS.map((col) => row[col]).join("|");
    if (seenRawKeys.has(rawKey)) {
      exactDuplicatesRemoved++;
      continue;
    }
    seenRawKeys.add(rawKey);

    const outcome = validateAndCleanRow(row);
    if (!outcome.ok) {
      rejected.push({ lineNo, rawLine, ...outcome.rejection });
      continue;
    }

    for (const code of outcome.issues) {
      const example = code.startsWith("TIMESTAMP")
        ? row.timestamp
        : code === "STATUS_CODE_INVALID"
          ? row.status_code
          : code.startsWith("LATENCY")
            ? row.latency
            : undefined;
      bumpIssue(code, example);
    }

    cleanedRaw.push(outcome.check);
  }

  const { deduped, observerDuplicatesResolved } = resolveObserverConflicts(cleanedRaw);
  if (exactDuplicatesRemoved > 0) {
    issueCounts.set("EXACT_DUPLICATE_REMOVED", { count: exactDuplicatesRemoved });
  }
  if (observerDuplicatesResolved > 0) {
    issueCounts.set("OBSERVER_CONFLICT_RESOLVED", { count: observerDuplicatesResolved });
  }

  const issues: QualityIssue[] = [...issueCounts.entries()].map(([code, { count, example }]) => ({
    code,
    count,
    severity: ISSUE_SEVERITY[code],
    ...(example ? { example } : {}),
  }));

  return {
    cleaned: deduped,
    rejected,
    issues,
    rowsReceived,
    exactDuplicatesRemoved,
    observerDuplicatesResolved,
  };
}
