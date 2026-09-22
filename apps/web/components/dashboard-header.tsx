"use client";

import { ChevronDown, RefreshCw, Upload } from "lucide-react";
import type { UploadSummaryDto } from "@sla/core";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";

export type ApiStatus = "checking" | "operational" | "unreachable";

export function DashboardHeader({
  datasets,
  selectedId,
  onSelect,
  onUploadClick,
  onRefresh,
  refreshing,
  apiStatus,
}: {
  datasets: UploadSummaryDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUploadClick: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  apiStatus: ApiStatus;
}) {
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-350 flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between md:py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft">
            <span className="relative flex h-2.5 w-2.5">
              <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
            </span>
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold leading-tight text-text sm:text-2xl">
              SLA Monitor
            </h1>
            <p className="text-[13px] leading-tight text-text-muted">
              Service reliability &amp; health telemetry
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <StatusIndicator status={apiStatus} />

          {datasets.length > 0 && (
            <div className="relative">
              <select
                id="dataset-select"
                name="dataset"
                aria-label="Select dataset"
                value={selectedId ?? ""}
                onChange={(e) => onSelect(e.target.value)}
                className={cn(
                  "h-9 appearance-none rounded-md border border-border bg-surface-raised py-0 pl-3 pr-8 text-sm text-text",
                  "hover:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  "max-w-55 truncate",
                )}
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            </div>
          )}

          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Refresh data">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button variant="primary" size="sm" onClick={onUploadClick}>
            <Upload className="h-4 w-4" />
            <span>Upload CSV</span>
          </Button>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function StatusIndicator({ status }: { status: ApiStatus }) {
  const config = {
    checking: { label: "Connecting…", dot: "bg-text-faint" },
    operational: { label: "Monitoring pipeline operational", dot: "bg-success" },
    unreachable: { label: "Worker unreachable", dot: "bg-danger" },
  }[status];

  return (
    <div className="hidden items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-[12px] text-text-muted lg:flex">
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {config.label}
    </div>
  );
}
