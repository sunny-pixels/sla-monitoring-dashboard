/**
 * Wire-format (JSON-safe) types shared between the Worker and the Next.js
 * dashboard. Kept separate from types.ts because these use ISO date strings
 * instead of Date objects — the boundary format for anything crossing HTTP.
 */

import type { DerivedIncident, QualityIssue } from "./types.js";

export interface UploadSummaryDto {
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
  rangeStart: string | null;
  rangeEnd: string | null;
  intervalSeconds: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface IncidentDto extends Omit<DerivedIncident, "startedAt" | "endedAt"> {
  startedAt: string;
  endedAt: string;
}

export interface StatsResponseDto {
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
  incidents: IncidentDto[];
  dailyAvailability: Array<{ date: string; availabilityPct: number | null; validCheckpoints: number }>;
}

export interface LogRowDto {
  id: string;
  serviceId: string;
  serviceName: string;
  checkedAt: string;
  statusCode: number;
  statusValid: boolean;
  isSuccess: boolean;
  latencyMs: number | null;
  agent: string;
  region: string;
}

export interface LogsResponseDto {
  data: LogRowDto[];
  pagination: { page: number; pageSize: number; total: number };
}

export interface ChunkUploadResponseDto {
  success: true;
  chunk: {
    rowsReceived: number;
    rowsAccepted: number;
    rowsRejected: number;
    exactDuplicatesRemoved: number;
    observerDuplicatesResolved: number;
  };
}

export interface FinalizeResponseDto {
  success: true;
  summary: {
    rowsReceived: number;
    rowsAccepted: number;
    rowsRejected: number;
    exactDuplicatesRemoved: number;
    observerDuplicatesResolved: number;
    checkPointsObserved: number;
    checkPointsExpected: number;
    rangeStart: string | null;
    rangeEnd: string | null;
    daysCovered: number | null;
  };
  qualityIssues: QualityIssue[];
}

export interface ApiErrorDto {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
