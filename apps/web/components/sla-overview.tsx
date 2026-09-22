"use client";

import { useState } from "react";
import { AlertOctagon, CheckCircle2, ChevronDown, Clock, Gauge, Globe, Server } from "lucide-react";
import type { StatsResponseDto } from "@sla/core";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { AvailabilityBar } from "@/components/availability-bar";
import { DailyAvailabilityChart } from "@/components/daily-availability-chart";
import { StatItem } from "@/components/stat-item";
import { IncidentsPanel } from "@/components/incidents-panel";
import { formatDateShort, formatLatency, formatNumber, formatPct } from "@/lib/format";
import { cn } from "@/lib/cn";

export function SlaOverview({
  stats,
  loading,
  error,
  targetPct,
}: {
  stats: StatsResponseDto | null;
  loading: boolean;
  error: string | null;
  targetPct: number;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <CollapsibleTrigger asChild>
          <button
            className="flex w-full items-center justify-between px-5 py-4 text-left"
            aria-expanded={open}
          >
            <span className="flex items-center gap-2 font-display text-[13px] font-semibold uppercase tracking-wide text-text-muted">
              <Gauge className="h-4 w-4" />
              SLA Overview
            </span>
            <ChevronDown className={cn("h-4 w-4 text-text-faint transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-border px-5 py-5">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-danger-border bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
                <AlertOctagon className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {!error && loading && <OverviewSkeleton />}

            {!error && !loading && stats && (
              <div className="flex flex-col gap-6">
                <AvailabilityBar availabilityPct={stats.availabilityPct} targetPct={targetPct} />

                {stats.dailyAvailability.length > 1 && (
                  <DailyAvailabilityChart data={stats.dailyAvailability} targetPct={targetPct} />
                )}

                <div className="grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-3 lg:grid-cols-6">
                  <StatItem icon={CheckCircle2} label="Valid Checks" value={formatNumber(stats.validCheckpoints)} />
                  <StatItem
                    icon={AlertOctagon}
                    label="Failed Checks"
                    value={formatNumber(stats.failedCheckpoints)}
                    tone={stats.failedCheckpoints > 0 ? "danger" : "default"}
                  />
                  <StatItem icon={Clock} label="Avg Latency" value={formatLatency(stats.latency.avgMs)} />
                  <StatItem icon={Server} label="Services" value={String(stats.servicesMonitored)} />
                  <StatItem
                    icon={Globe}
                    label="Coverage"
                    value={formatPct(stats.coveragePct, 2)}
                    tone={stats.coveragePct !== null && stats.coveragePct < 100 ? "warning" : "default"}
                  />
                  <StatItem
                    icon={Clock}
                    label="Date Range"
                    value={
                      stats.rangeStart && stats.rangeEnd
                        ? `${formatDateShort(stats.rangeStart)} – ${formatDateShort(stats.rangeEnd)}`
                        : "—"
                    }
                  />
                </div>

                {stats.perService.length > 0 && (
                  <div className="border-t border-border pt-5">
                    <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-text-faint">
                      Per-service availability
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {stats.perService.map((s) => (
                        <div key={s.serviceId} className="rounded-lg border border-border px-3 py-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] font-medium text-text">{s.serviceId}</span>
                            <span
                              className={cn(
                                "font-mono text-[13px] font-semibold",
                                s.availabilityPct !== null && s.availabilityPct >= targetPct
                                  ? "text-success"
                                  : "text-danger",
                              )}
                            >
                              {formatPct(s.availabilityPct)}
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-soft">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                s.availabilityPct !== null && s.availabilityPct >= targetPct
                                  ? "bg-success"
                                  : "bg-danger",
                              )}
                              style={{ width: `${Math.max(2, s.availabilityPct ?? 0)}%` }}
                            />
                          </div>
                          <div className="mt-1.5 font-mono text-[11px] text-text-faint">
                            p95 {formatLatency(s.latencyP95Ms)} · avg {formatLatency(s.latencyAvgMs)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t border-border pt-5">
                  <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-text-faint">
                    Derived incidents
                  </h3>
                  <IncidentsPanel incidents={stats.incidents} />
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-2.5 w-full rounded-full" />
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
