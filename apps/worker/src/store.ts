/**
 * Storage abstraction for the Worker. `MemoryStore` (memory-store.ts) is a
 * LOCAL-DEV-ONLY placeholder used while `wrangler dev` runs without a
 * Supabase project configured — it lives in module scope and is lost on
 * restart, which is fine for iterating on the UI but is NOT the persistence
 * layer the assignment requires. `SupabaseStore` implements the same
 * interface against Postgres (see database/schema.sql) and is what the
 * deployed Worker actually uses; swapping is a one-line change in index.ts
 * based on whether SUPABASE_URL is configured.
 */

import type { CleanedCheck, DerivedIncident, QualityIssue, RejectedRow, SlaStats } from "@sla/core";

export interface DailyAvailability {
  date: string;
  availabilityPct: number | null;
  validCheckpoints: number;
}

/** A persisted check as returned for the logs view — carries a stable row id. */
export interface LogCheckRecord extends CleanedCheck {
  id: string;
}

export interface UploadRecord {
  id: string;
  filename: string;
  fileSizeBytes: number;
  status: "processing" | "completed" | "failed";
  rowsReceived: number;
  rowsAccepted: number;
  rowsRejected: number;
  exactDuplicatesRemoved: number;
  observerDuplicatesResolved: number;
  qualityIssues: QualityIssue[];
  intervalSeconds: number | null;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface LogsQuery {
  date?: string; // YYYY-MM-DD, single-day filter
  from?: string; // ISO, range filter
  to?: string; // ISO, range filter
  service?: string;
  status?: "success" | "failed" | "invalid";
  page: number;
  pageSize: number;
}

export interface StatsQuery {
  from?: string;
  to?: string;
}

export interface Store {
  createUpload(meta: { filename: string; fileSizeBytes: number }): Promise<UploadRecord>;

  /** Appends one chunk's cleaned checks + rejected rows + quality issues to an in-progress upload. */
  appendChunk(
    uploadId: string,
    chunk: {
      cleaned: CleanedCheck[];
      rejected: RejectedRow[];
      issues: QualityIssue[];
      rowsReceived: number;
      exactDuplicatesRemoved: number;
      observerDuplicatesResolved: number;
    },
  ): Promise<void>;

  /** Computes final coverage/incidents and marks the upload completed. Returns the final record. */
  finalizeUpload(uploadId: string): Promise<UploadRecord>;

  listUploads(): Promise<UploadRecord[]>;
  getUpload(uploadId: string): Promise<UploadRecord | null>;

  getStats(
    uploadId: string,
    query: StatsQuery,
  ): Promise<{
    stats: SlaStats;
    incidents: DerivedIncident[];
    dailyAvailability: DailyAvailability[];
  } | null>;

  getLogs(
    uploadId: string,
    query: LogsQuery,
  ): Promise<{ data: LogCheckRecord[]; total: number } | null>;
}
