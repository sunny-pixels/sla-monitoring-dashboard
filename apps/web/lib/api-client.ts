/**
 * Typed client for the Cloudflare Worker API. Talks directly to
 * NEXT_PUBLIC_API_BASE_URL — never through a Next.js API route — matching
 * the required architecture (browser -> deployed serverless function).
 *
 * Only types are imported from @sla/core (erased at build time); no runtime
 * code from the ingest pipeline ships to the browser.
 */
import type {
  ApiErrorDto,
  ChunkUploadResponseDto,
  FinalizeResponseDto,
  LogsResponseDto,
  StatsResponseDto,
  UploadSummaryDto,
} from "@sla/core";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when the Worker cannot be reached at all (network failure, not an API error response). */
export class NetworkUnavailableError extends Error {
  constructor(message = "Could not reach the monitoring service. Check your connection and try again.") {
    super(message);
    this.name = "NetworkUnavailableError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError(
      "NOT_CONFIGURED",
      "NEXT_PUBLIC_API_BASE_URL is not set. The dashboard has no Worker to talk to.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    throw new NetworkUnavailableError();
  }

  if (!res.ok) {
    let body: ApiErrorDto | null = null;
    try {
      body = await res.json();
    } catch {
      // response wasn't JSON — fall through to a generic message
    }
    throw new ApiError(
      body?.error?.code ?? "UNKNOWN_ERROR",
      body?.error?.message ?? `Request failed with status ${res.status}`,
      res.status,
    );
  }

  return res.json() as Promise<T>;
}

export interface CreateUploadResult {
  upload: UploadSummaryDto;
}

export function createUpload(filename: string, fileSizeBytes: number): Promise<CreateUploadResult> {
  return request("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, fileSizeBytes }),
  });
}

export function uploadChunk(uploadId: string, csvText: string): Promise<ChunkUploadResponseDto> {
  return request(`/api/uploads/${uploadId}/chunk`, {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    body: csvText,
  });
}

export function finalizeUpload(uploadId: string): Promise<FinalizeResponseDto> {
  return request(`/api/uploads/${uploadId}/finalize`, { method: "POST" });
}

export async function listDatasets(): Promise<UploadSummaryDto[]> {
  const res = await request<{ data: UploadSummaryDto[] }>("/api/datasets");
  return res.data;
}

export interface StatsQuery {
  from?: string;
  to?: string;
}

export function getStats(uploadId: string, query: StatsQuery = {}): Promise<StatsResponseDto> {
  const params = new URLSearchParams({ uploadId });
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return request(`/api/stats?${params.toString()}`);
}

export interface LogsQuery {
  date?: string;
  from?: string;
  to?: string;
  service?: string;
  status?: "success" | "failed" | "invalid";
  page: number;
  pageSize: number;
}

export function getLogs(uploadId: string, query: LogsQuery): Promise<LogsResponseDto> {
  const params = new URLSearchParams({ uploadId, page: String(query.page), pageSize: String(query.pageSize) });
  if (query.date) params.set("date", query.date);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.service) params.set("service", query.service);
  if (query.status) params.set("status", query.status);
  return request(`/api/logs?${params.toString()}`);
}

export function checkHealth(): Promise<{ status: string }> {
  return request("/api/health");
}
