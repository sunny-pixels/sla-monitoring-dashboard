/**
 * Row-level validation and cleaning — the centralized rules from
 * docs/data-audit.md §2. This is the ONLY place these rules are implemented;
 * the Worker calls it per row and the frontend never re-derives them.
 *
 * Rejection is reserved for rows that cannot yield a trustworthy
 * availability observation at all (no identity, no time, no status). Latency
 * problems (I5, I7) never cause rejection — see the reasoning in the audit:
 * a bad latency does not invalidate a good status-code observation.
 */

import { parseTimestamp } from "./timestamp.js";
import type { CleanedCheck, QualityIssueCode, RawRow, RejectedRow, RequiredColumn } from "./types.js";

export type ValidationOutcome =
  | { ok: true; check: CleanedCheck; issues: QualityIssueCode[] }
  | { ok: false; rejection: Omit<RejectedRow, "lineNo" | "rawLine"> };

const VALID_STATUS_MIN = 100;
const VALID_STATUS_MAX = 599; // inclusive; anything outside [100,599] is not a real HTTP status

function isBlank(v: string): boolean {
  return v.trim() === "";
}

/** Converts a raw latency value + unit to milliseconds, or null when unusable (I4, I5, I7). */
function normalizeLatency(
  raw: string,
  unit: string,
): { latencyMs: number | null; issue: QualityIssueCode | null } {
  const trimmed = raw.trim();
  if (trimmed === "") return { latencyMs: null, issue: "LATENCY_MISSING" };

  const num = Number(trimmed);
  if (!Number.isFinite(num)) return { latencyMs: null, issue: "LATENCY_UNPARSEABLE" };

  if (num < 0) return { latencyMs: null, issue: "LATENCY_NEGATIVE" };

  const normalizedUnit = unit.trim().toLowerCase();
  const ms = normalizedUnit === "s" || normalizedUnit === "sec" || normalizedUnit === "secs"
    ? num * 1000
    : num; // default: already milliseconds
  return { latencyMs: Math.round(ms), issue: null };
}

/**
 * Validates and cleans a single raw row. Never throws — every possible
 * malformation resolves to either a CleanedCheck or a structured rejection.
 */
export function validateAndCleanRow(row: RawRow): ValidationOutcome {
  const required: RequiredColumn[] = ["service_id", "service_name", "agent", "region"];
  for (const field of required) {
    if (isBlank(row[field])) {
      return { ok: false, rejection: { field, reason: "MISSING_REQUIRED_FIELD" } };
    }
  }

  const { date, format } = parseTimestamp(row.timestamp);
  if (!date) {
    return { ok: false, rejection: { field: "timestamp", reason: "INVALID_TIMESTAMP" } };
  }

  const statusRaw = row.status_code.trim();
  if (statusRaw === "" || !/^-?\d+$/.test(statusRaw)) {
    return { ok: false, rejection: { field: "status_code", reason: "INVALID_STATUS_CODE" } };
  }
  const statusCode = Number(statusRaw);

  const issues: QualityIssueCode[] = [];
  if (format === "iso_offset") issues.push("TIMESTAMP_NORMALIZED_OFFSET");
  if (format === "epoch_s" || format === "epoch_ms") issues.push("TIMESTAMP_NORMALIZED_EPOCH");

  // I3: codes outside a real HTTP range (e.g. 999) are probe artifacts, not
  // service failures — excluded from the SLA denominator but kept and shown.
  const statusValid = statusCode >= VALID_STATUS_MIN && statusCode <= VALID_STATUS_MAX;
  if (!statusValid) issues.push("STATUS_CODE_INVALID");
  const isSuccess = statusValid && statusCode >= 200 && statusCode < 400;

  const { latencyMs, issue: latencyIssue } = normalizeLatency(row.latency, row.latency_unit);
  if (latencyIssue) issues.push(latencyIssue);

  const check: CleanedCheck = {
    serviceId: row.service_id,
    serviceName: row.service_name,
    checkedAt: date,
    checkedAtRaw: row.timestamp,
    statusCode,
    statusValid,
    isSuccess,
    latencyMs,
    latencyRaw: row.latency,
    latencyUnit: row.latency_unit,
    agent: row.agent,
    region: row.region,
  };

  return { ok: true, check, issues };
}
