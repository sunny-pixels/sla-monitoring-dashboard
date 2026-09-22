/**
 * The Cloudflare Worker — the "stateless processing" step the assignment
 * requires the browser to talk to directly (no Next.js API route proxies
 * this). Responsible for parsing, validating, cleaning and persisting
 * uploaded CSV chunks, and for serving the dashboard's stats/logs queries.
 *
 * Storage is pluggable (see store.ts): SupabaseStore (real, persistent
 * Postgres — see database/schema.sql) is used whenever SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are configured; MemoryStore (memory-store.ts) is
 * an explicitly-labeled local-dev-only fallback for iterating on the UI
 * without a Supabase project. The Worker is created fresh per request
 * (getStore()), matching how Workers isolates actually behave — nothing
 * about correctness depends on any module-level state surviving between
 * requests.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  processCsvText,
  SchemaValidationError,
  type ApiErrorDto,
  type ChunkUploadResponseDto,
  type FinalizeResponseDto,
  type LogRowDto,
  type LogsResponseDto,
  type StatsResponseDto,
  type UploadSummaryDto,
} from "@sla/core";
import { createMemoryStore } from "./memory-store.js";
import { createSupabaseStore } from "./supabase-store.js";
import type { LogsQuery, Store, UploadRecord } from "./store.js";

interface Bindings {
  ALLOWED_ORIGINS?: string;
  MAX_CHUNK_BYTES?: string;
  MAX_ROWS_PER_UPLOAD?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const DEFAULT_MAX_CHUNK_BYTES = 1_048_576; // 1MB
const DEFAULT_MAX_ROWS_PER_UPLOAD = 250_000;

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? ["http://localhost:3000"];
  return cors({ origin: allowed, allowMethods: ["GET", "POST", "OPTIONS"] })(c, next);
});

function getStore(env: Bindings): Store {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return createMemoryStore();
}

function activeStoreName(env: Bindings): "supabase" | "memory" {
  return env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "memory";
}

function errorResponse(code: string, message: string): ApiErrorDto {
  return { success: false, error: { code, message } };
}

function toUploadSummaryDto(u: UploadRecord): UploadSummaryDto {
  return {
    id: u.id,
    filename: u.filename,
    fileSizeBytes: u.fileSizeBytes,
    status: u.status,
    rowsReceived: u.rowsReceived,
    rowsAccepted: u.rowsAccepted,
    rowsRejected: u.rowsRejected,
    exactDuplicatesRemoved: u.exactDuplicatesRemoved,
    observerDuplicatesResolved: u.observerDuplicatesResolved,
    qualityIssues: u.qualityIssues,
    rangeStart: u.rangeStart?.toISOString() ?? null,
    rangeEnd: u.rangeEnd?.toISOString() ?? null,
    intervalSeconds: u.intervalSeconds,
    createdAt: u.createdAt.toISOString(),
    completedAt: u.completedAt?.toISOString() ?? null,
  };
}

app.get("/api/health", (c) =>
  c.json({ status: "ok", store: activeStoreName(c.env), time: new Date().toISOString() }),
);

app.post("/api/uploads", async (c) => {
  const store = getStore(c.env);
  const body = await c.req.json<{ filename?: string; fileSizeBytes?: number }>().catch(() => null);
  if (!body?.filename) {
    return c.json(errorResponse("INVALID_REQUEST", "filename is required"), 400);
  }
  const record = await store.createUpload({
    filename: body.filename,
    fileSizeBytes: body.fileSizeBytes ?? 0,
  });
  return c.json({ success: true, upload: toUploadSummaryDto(record) });
});

app.post("/api/uploads/:id/chunk", async (c) => {
  const store = getStore(c.env);
  const uploadId = c.req.param("id");
  const existing = await store.getUpload(uploadId);
  if (!existing) return c.json(errorResponse("UPLOAD_NOT_FOUND", "Unknown upload id"), 404);
  if (existing.status !== "processing") {
    return c.json(errorResponse("UPLOAD_CLOSED", "This upload has already been finalized"), 409);
  }

  const maxChunkBytes = Number(c.env.MAX_CHUNK_BYTES ?? DEFAULT_MAX_CHUNK_BYTES);
  const maxRows = Number(c.env.MAX_ROWS_PER_UPLOAD ?? DEFAULT_MAX_ROWS_PER_UPLOAD);

  const text = await c.req.text();
  if (text.length > maxChunkBytes) {
    return c.json(errorResponse("CHUNK_TOO_LARGE", `Chunk exceeds ${maxChunkBytes} bytes`), 413);
  }
  if (existing.rowsReceived > maxRows) {
    return c.json(errorResponse("UPLOAD_TOO_LARGE", `Upload exceeds ${maxRows} rows`), 413);
  }

  let result;
  try {
    result = processCsvText(text);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      return c.json(
        errorResponse("MISSING_COLUMNS", `CSV is missing required column(s): ${err.missingColumns.join(", ")}`),
        400,
      );
    }
    throw err;
  }

  await store.appendChunk(uploadId, result);

  const response: ChunkUploadResponseDto = {
    success: true,
    chunk: {
      rowsReceived: result.rowsReceived,
      rowsAccepted: result.cleaned.length,
      rowsRejected: result.rejected.length,
      exactDuplicatesRemoved: result.exactDuplicatesRemoved,
      observerDuplicatesResolved: result.observerDuplicatesResolved,
    },
  };
  return c.json(response);
});

app.post("/api/uploads/:id/finalize", async (c) => {
  const store = getStore(c.env);
  const uploadId = c.req.param("id");
  const existing = await store.getUpload(uploadId);
  if (!existing) return c.json(errorResponse("UPLOAD_NOT_FOUND", "Unknown upload id"), 404);

  const finalRecord = await store.finalizeUpload(uploadId);
  const statsResult = await store.getStats(uploadId, {});

  // floor(), not round(): a range spanning e.g. 8d23h45m covers 9 CALENDAR
  // days (00:00 day 1 through 23:45 day 9), and round() would overcount to
  // 10 by rounding the trailing 23h45m up to a full extra day.
  const daysCovered =
    finalRecord.rangeStart && finalRecord.rangeEnd
      ? Math.floor((finalRecord.rangeEnd.getTime() - finalRecord.rangeStart.getTime()) / 86_400_000) + 1
      : null;

  const response: FinalizeResponseDto = {
    success: true,
    summary: {
      rowsReceived: finalRecord.rowsReceived,
      rowsAccepted: finalRecord.rowsAccepted,
      rowsRejected: finalRecord.rowsRejected,
      exactDuplicatesRemoved: finalRecord.exactDuplicatesRemoved,
      observerDuplicatesResolved: finalRecord.observerDuplicatesResolved,
      checkPointsObserved: statsResult?.stats.validCheckpoints ?? 0,
      checkPointsExpected: statsResult?.stats.expectedCheckpoints ?? 0,
      rangeStart: finalRecord.rangeStart?.toISOString() ?? null,
      rangeEnd: finalRecord.rangeEnd?.toISOString() ?? null,
      daysCovered,
    },
    qualityIssues: finalRecord.qualityIssues,
  };
  return c.json(response);
});

app.get("/api/datasets", async (c) => {
  const store = getStore(c.env);
  const list = await store.listUploads();
  return c.json({ data: list.map(toUploadSummaryDto) });
});

app.get("/api/stats", async (c) => {
  const store = getStore(c.env);
  const uploadId = c.req.query("uploadId");
  if (!uploadId) return c.json(errorResponse("INVALID_REQUEST", "uploadId is required"), 400);

  const result = await store.getStats(uploadId, {
    from: c.req.query("from"),
    to: c.req.query("to"),
  });
  if (!result) return c.json(errorResponse("UPLOAD_NOT_FOUND", "Unknown upload id"), 404);

  const { stats, incidents, dailyAvailability } = result;
  const response: StatsResponseDto = {
    validCheckpoints: stats.validCheckpoints,
    successfulCheckpoints: stats.successfulCheckpoints,
    failedCheckpoints: stats.failedCheckpoints,
    availabilityPct: stats.availabilityPct,
    expectedCheckpoints: stats.expectedCheckpoints,
    coveragePct: stats.coveragePct,
    latency: stats.latency,
    rangeStart: stats.rangeStart?.toISOString() ?? null,
    rangeEnd: stats.rangeEnd?.toISOString() ?? null,
    servicesMonitored: stats.servicesMonitored,
    intervalSeconds: stats.intervalSeconds,
    perService: stats.perService,
    incidents: incidents.map((i) => ({
      ...i,
      startedAt: i.startedAt.toISOString(),
      endedAt: i.endedAt.toISOString(),
    })),
    dailyAvailability,
  };
  return c.json(response);
});

app.get("/api/logs", async (c) => {
  const store = getStore(c.env);
  const uploadId = c.req.query("uploadId");
  if (!uploadId) return c.json(errorResponse("INVALID_REQUEST", "uploadId is required"), 400);

  const page = Math.max(1, Number(c.req.query("page") ?? "1"));
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query("pageSize") ?? "50")));

  const query: LogsQuery = {
    date: c.req.query("date"),
    from: c.req.query("from"),
    to: c.req.query("to"),
    service: c.req.query("service"),
    status: c.req.query("status") as LogsQuery["status"],
    page,
    pageSize,
  };

  const result = await store.getLogs(uploadId, query);
  if (!result) return c.json(errorResponse("UPLOAD_NOT_FOUND", "Unknown upload id"), 404);

  const rows: LogRowDto[] = result.data.map((row) => ({
    id: row.id,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    checkedAt: row.checkedAt.toISOString(),
    statusCode: row.statusCode,
    statusValid: row.statusValid,
    isSuccess: row.isSuccess,
    latencyMs: row.latencyMs,
    agent: row.agent,
    region: row.region,
  }));

  const response: LogsResponseDto = {
    data: rows,
    pagination: { page, pageSize, total: result.total },
  };
  return c.json(response);
});

app.onError((err, c) => {
  console.error(err);
  return c.json(errorResponse("INTERNAL_ERROR", "Something went wrong processing your request."), 500);
});

export default app;
