"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Upload as UploadIcon, X } from "lucide-react";
import type { FinalizeResponseDto } from "@sla/core";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProcessingStatus } from "@/components/processing-status";
import { uploadCsvFile, validateFile, type UploadProgress } from "@/lib/upload";
import { formatBytes, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

type LocalStage = "idle" | "selected" | "processing" | "done" | "error";

export function UploadDialog({
  open,
  onOpenChange,
  onUploadComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: () => void;
}) {
  const [stage, setStage] = useState<LocalStage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [result, setResult] = useState<FinalizeResponseDto | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStage("idle");
    setFile(null);
    setValidationError(null);
    setProgress(null);
    setResult(null);
    setDragOver(false);
  }

  function handleFile(f: File) {
    const validation = validateFile(f);
    if (!validation.ok) {
      setFile(f);
      setValidationError(validation.reason ?? "This file could not be used.");
      setStage("selected");
      return;
    }
    setFile(f);
    setValidationError(null);
    setStage("selected");
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleFile(dropped);
  }, []);

  async function startProcessing() {
    if (!file || validationError) return;
    setStage("processing");
    try {
      const final = await uploadCsvFile(file, setProgress);
      setResult(final);
      setStage("done");
    } catch {
      setStage("error");
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && stage === "done") onUploadComplete();
    if (!next) reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onOpenAutoFocus={(e) => stage !== "idle" && e.preventDefault()}>
        <div className="p-6">
          <DialogTitle>Upload monitoring dataset</DialogTitle>
          <DialogDescription className="mt-1">
            CSV files only, following the health-check schema · max 20MB
          </DialogDescription>

          <div className="mt-5">
            {stage === "idle" && (
              <Dropzone
                dragOver={dragOver}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onBrowse={() => inputRef.current?.click()}
              />
            )}

            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />

            {stage === "selected" && file && (
              <div className="flex flex-col gap-4">
                <FilePreview file={file} error={validationError} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={reset}>
                    Choose a different file
                  </Button>
                  <Button variant="primary" size="sm" onClick={startProcessing} disabled={!!validationError}>
                    Process Dataset
                  </Button>
                </div>
              </div>
            )}

            {stage === "processing" && progress && (
              <ProcessingStatus stage={progress.stage} chunksSent={progress.chunksSent} totalChunks={progress.totalChunks} />
            )}

            {stage === "done" && result && (
              <UploadSummaryView result={result} onDone={() => handleOpenChange(false)} />
            )}

            {stage === "error" && (
              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-2.5 rounded-lg border border-danger-border bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{progress?.errorMessage ?? "Upload failed. Please check the file and try again."}</span>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={reset}>
                    Try again
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Dropzone({
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onBrowse,
}: {
  dragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onBrowse: () => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onBrowse}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onBrowse()}
      aria-label="Upload CSV file"
      className={cn(
        "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
        dragOver ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong hover:bg-neutral-soft",
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <UploadIcon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-[14px] font-medium text-text">Drop CSV here</p>
        <p className="mt-0.5 text-[13px] text-text-muted">
          or <span className="text-accent-text underline underline-offset-2">browse files</span>
        </p>
      </div>
    </div>
  );
}

function FilePreview({ file, error }: { file: File; error: string | null }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3.5 py-3",
        error ? "border-danger-border bg-danger-soft" : "border-border bg-surface",
      )}
    >
      <FileText className={cn("h-5 w-5 shrink-0", error ? "text-danger" : "text-text-faint")} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-text">{file.name}</p>
        <p className="text-[12px] text-text-muted">{formatBytes(file.size)}</p>
      </div>
      {error ? (
        <span className="flex items-center gap-1 text-[12px] text-danger">
          <AlertCircle className="h-3.5 w-3.5" /> Invalid
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[12px] text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> Ready
        </span>
      )}
      {error && <p className="sr-only">{error}</p>}
    </div>
  );
}

function UploadSummaryView({ result, onDone }: { result: FinalizeResponseDto; onDone: () => void }) {
  const { summary, qualityIssues } = result;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5 rounded-lg border border-success-border bg-success-soft px-3.5 py-3 text-success">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        <span className="text-[13px] font-medium">Dataset processed</span>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        <SummaryStat label="Received" value={summary.rowsReceived} />
        <SummaryStat label="Accepted" value={summary.rowsAccepted} tone="success" />
        <SummaryStat label="Rejected" value={summary.rowsRejected} tone={summary.rowsRejected > 0 ? "danger" : undefined} />
        <SummaryStat label="Duplicates" value={summary.exactDuplicatesRemoved + summary.observerDuplicatesResolved} />
      </dl>

      {qualityIssues.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-faint">
            Data quality notes
          </h4>
          <ul className="flex flex-col gap-1.5">
            {qualityIssues.map((issue) => (
              <li key={issue.code} className="flex items-center justify-between rounded-md bg-neutral-soft px-2.5 py-1.5 text-[12px]">
                <span className="text-text-muted">{issue.code.replaceAll("_", " ").toLowerCase()}</span>
                <Badge tone={issue.severity === "warning" ? "warning" : "neutral"}>{issue.count}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={onDone}>
          View dashboard
        </Button>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-text-faint">{label}</dt>
      <dd
        className={cn(
          "font-mono text-[16px] font-semibold",
          tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-text",
        )}
      >
        {formatNumber(value)}
      </dd>
    </div>
  );
}
