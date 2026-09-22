/**
 * Client-side upload orchestration. Splits the file into chunks (each
 * carrying its own header line) and POSTs them sequentially to the Worker —
 * this is what makes the upload progress genuine rather than a simulated
 * bar, and keeps each request small enough for the Worker's free-tier CPU
 * budget regardless of how large the file is.
 */
import type { FinalizeResponseDto } from "@sla/core";
import { createUpload, finalizeUpload, uploadChunk } from "./api-client";

const ROWS_PER_CHUNK = 1000;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB — generous relative to the largest fixture (~1.1MB)

export interface FileValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateFile(file: File): FileValidationResult {
  const looksLikeCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
  if (!looksLikeCsv) {
    return { ok: false, reason: "Unsupported file type. Please upload a .csv file." };
  }
  if (file.size === 0) {
    return { ok: false, reason: "This file is empty." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, reason: `File is too large (max ${MAX_FILE_BYTES / (1024 * 1024)}MB).` };
  }
  return { ok: true };
}

export type UploadStage = "uploading" | "finalizing" | "done" | "error";

export interface UploadProgress {
  stage: UploadStage;
  chunksSent: number;
  totalChunks: number;
  rowsAccepted: number;
  rowsRejected: number;
  errorMessage?: string;
}

function splitIntoLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed === "" ? [] : trimmed.split("\n");
}

export async function uploadCsvFile(
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<FinalizeResponseDto> {
  const text = await file.text();
  const lines = splitIntoLines(text);

  if (lines.length === 0) {
    const err = "The file is empty.";
    onProgress({ stage: "error", chunksSent: 0, totalChunks: 0, rowsAccepted: 0, rowsRejected: 0, errorMessage: err });
    throw new Error(err);
  }

  const header = lines[0]!;
  const dataLines = lines.slice(1).filter((l) => l.trim() !== "");
  const totalChunks = Math.max(1, Math.ceil(dataLines.length / ROWS_PER_CHUNK));

  let rowsAccepted = 0;
  let rowsRejected = 0;

  try {
    const { upload } = await createUpload(file.name, file.size);

    onProgress({ stage: "uploading", chunksSent: 0, totalChunks, rowsAccepted, rowsRejected });

    for (let i = 0; i < totalChunks; i++) {
      const start = i * ROWS_PER_CHUNK;
      const chunkRows = dataLines.slice(start, start + ROWS_PER_CHUNK);
      const body = [header, ...chunkRows].join("\r\n");

      const result = await uploadChunk(upload.id, body);
      rowsAccepted += result.chunk.rowsAccepted;
      rowsRejected += result.chunk.rowsRejected;

      onProgress({ stage: "uploading", chunksSent: i + 1, totalChunks, rowsAccepted, rowsRejected });
    }

    onProgress({ stage: "finalizing", chunksSent: totalChunks, totalChunks, rowsAccepted, rowsRejected });
    const final = await finalizeUpload(upload.id);

    onProgress({
      stage: "done",
      chunksSent: totalChunks,
      totalChunks,
      rowsAccepted: final.summary.rowsAccepted,
      rowsRejected: final.summary.rowsRejected,
    });

    return final;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed unexpectedly.";
    onProgress({ stage: "error", chunksSent: 0, totalChunks, rowsAccepted, rowsRejected, errorMessage: message });
    throw err;
  }
}
