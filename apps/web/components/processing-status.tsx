import { Check, Loader2 } from "lucide-react";
import type { UploadStage } from "@/lib/upload";
import { cn } from "@/lib/cn";

const STEPS: { key: UploadStage; label: string }[] = [
  { key: "uploading", label: "Uploading & processing" },
  { key: "finalizing", label: "Finalizing" },
  { key: "done", label: "Complete" },
];

export function ProcessingStatus({
  stage,
  chunksSent,
  totalChunks,
}: {
  stage: UploadStage;
  chunksSent: number;
  totalChunks: number;
}) {
  const stageIndex = STEPS.findIndex((s) => s.key === stage);

  return (
    <div className="flex flex-col gap-3">
      {STEPS.map((step, i) => {
        const isDone = stageIndex > i || stage === "done";
        const isActive = stageIndex === i && stage !== "done";
        return (
          <div key={step.key} className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
                isDone
                  ? "border-success bg-success-soft text-success"
                  : isActive
                    ? "border-accent bg-accent-soft text-accent-text"
                    : "border-border text-text-faint",
              )}
            >
              {isDone ? (
                <Check className="h-3.5 w-3.5" />
              ) : isActive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                i + 1
              )}
            </div>
            <span className={cn("text-[13px]", isDone || isActive ? "text-text" : "text-text-faint")}>
              {step.label}
              {step.key === "uploading" && isActive && totalChunks > 1 && (
                <span className="ml-1.5 font-mono text-[12px] text-text-muted">
                  ({chunksSent}/{totalChunks})
                </span>
              )}
            </span>
          </div>
        );
      })}

      {stage === "uploading" && totalChunks > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-soft">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${Math.round((chunksSent / totalChunks) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
