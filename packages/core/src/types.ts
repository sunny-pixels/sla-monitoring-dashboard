/**
 * Shared types for the ingest pipeline. These are the contract between the
 * CSV parser, the validator, the Cloudflare Worker, and the Postgres schema
 * (database/schema.sql) — kept in one place so the frontend never needs to
 * re-derive validation rules.
 */

/** The 8 columns every supported CSV must provide, by name (order-independent). */
export const REQUIRED_COLUMNS = [
  "service_id",
  "service_name",
  "timestamp",
  "status_code",
  "latency",
  "latency_unit",
  "agent",
  "region",
] as const;

export type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

/** One raw CSV data row, keyed by column name after header resolution. */
export type RawRow = Record<RequiredColumn, string>;

/**
 * A machine-readable reason a row could not be salvaged. Every rejection is
 * persisted with one of these codes — see docs/data-audit.md §6
 * ("rows are never silently discarded").
 */
export type RejectionReason =
  | "MALFORMED_ROW" // field count does not match header
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_TIMESTAMP"
  | "INVALID_STATUS_CODE";

export interface RejectedRow {
  lineNo: number;
  rawLine: string;
  field: RequiredColumn | null;
  reason: RejectionReason;
}

/**
 * A code describing a data-quality condition that was *repaired* rather than
 * rejected. Counts of these are what the Worker returns as `qualityIssues`
 * and what docs/data-audit.md documents per issue (I1, I3, I5, I7).
 */
export type QualityIssueCode =
  | "TIMESTAMP_NORMALIZED_OFFSET" // I1: +05:30-style offset converted to UTC
  | "TIMESTAMP_NORMALIZED_EPOCH" // I1: unix epoch seconds/ms converted
  | "STATUS_CODE_INVALID" // I3: outside [100,600), e.g. 999 — kept, excluded from SLA denominator
  | "LATENCY_NEGATIVE" // I5: negative latency nulled, row kept
  | "LATENCY_MISSING" // I7: empty latency, row kept
  | "LATENCY_UNPARSEABLE" // latency present but not numeric, row kept
  | "EXACT_DUPLICATE_REMOVED" // I6a
  | "OBSERVER_CONFLICT_RESOLVED"; // I6b

export interface QualityIssue {
  code: QualityIssueCode;
  count: number;
  severity: "info" | "warning";
  example?: string;
}

/**
 * A fully validated, normalized health-check observation — the shape
 * persisted to `health_checks`. `checkedAt` is always UTC.
 */
export interface CleanedCheck {
  serviceId: string;
  serviceName: string;
  checkedAt: Date;
  /**
   * The timestamp exactly as written in the source row, before normalization.
   * Not persisted to the database — it exists so duplicate-detection can
   * distinguish a true byte-exact repeat from two rows that name the same
   * UTC instant in different formats (I1 x I6): e.g. `...Z` vs an equivalent
   * `+05:30` offset. Both resolve to the same `checkedAt`, but only the
   * former is a byte-exact duplicate; docs/data-audit.md §2 (I6b) documents
   * a real fixture row-pair of exactly this shape.
   */
  checkedAtRaw: string;
  statusCode: number;
  /** false for values outside [100,600), e.g. 999 (I3) — excluded from the SLA denominator. */
  statusValid: boolean;
  /** true only when statusValid && 200 <= statusCode < 400. */
  isSuccess: boolean;
  /** Normalized to milliseconds (I4). Null when unusable (I5 negative, I7 missing/unparseable). */
  latencyMs: number | null;
  latencyRaw: string;
  latencyUnit: string;
  agent: string;
  region: string;
}

export interface ProcessResult {
  cleaned: CleanedCheck[];
  rejected: RejectedRow[];
  issues: QualityIssue[];
  rowsReceived: number;
  exactDuplicatesRemoved: number;
  observerDuplicatesResolved: number;
}

/** One (service, interval) unit of SLA measurement — see docs/data-audit.md §5. */
export interface Checkpoint {
  serviceId: string;
  checkedAt: Date;
  statusCode: number;
  isSuccess: boolean;
  latencyMs: number | null;
}

export interface SlaStats {
  validCheckpoints: number;
  successfulCheckpoints: number;
  failedCheckpoints: number;
  availabilityPct: number | null;
  expectedCheckpoints: number;
  coveragePct: number | null;
  latency: {
    samples: number;
    avgMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
  };
  rangeStart: Date | null;
  rangeEnd: Date | null;
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
}

export interface DerivedIncident {
  serviceId: string;
  startedAt: Date;
  endedAt: Date;
  failedChecks: number;
  durationMinutes: number;
  severity: "minor" | "major" | "critical";
}
