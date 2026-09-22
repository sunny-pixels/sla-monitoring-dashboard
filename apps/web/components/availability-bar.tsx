"use client";

import { formatPct, formatSignedPct } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * A compact horizontal SLA indicator rather than a circular gauge — availability
 * figures here cluster tightly in the 97-100% band, so the scale is zoomed to
 * that band (not a literal 0-100% bar) to make the gap against target legible.
 */
export function AvailabilityBar({
  availabilityPct,
  targetPct,
}: {
  availabilityPct: number | null;
  targetPct: number;
}) {
  const value = availabilityPct ?? 0;
  const domainMin = Math.max(0, Math.floor(Math.min(value, targetPct) - 1));
  const domainMax = 100;
  const span = domainMax - domainMin;

  const toPct = (v: number) => Math.min(100, Math.max(0, ((v - domainMin) / span) * 100));
  const fillPct = toPct(value);
  const targetMarkerPct = toPct(targetPct);
  const meetsTarget = availabilityPct !== null && availabilityPct >= targetPct;
  const delta = availabilityPct !== null ? availabilityPct - targetPct : null;

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-display text-[34px] font-bold leading-none tracking-tight text-text sm:text-[38px]">
            {formatPct(availabilityPct, 3)}
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-text-muted">Availability</div>
        </div>
        <div className="text-right">
          <div className="font-display text-[22px] font-semibold leading-none text-text-muted sm:text-2xl">
            {targetPct.toFixed(2)}%
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-text-muted">SLA Target</div>
        </div>
      </div>

      <div className="relative mt-4 h-2.5 w-full overflow-visible rounded-full bg-neutral-soft">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            meetsTarget ? "bg-success" : "bg-danger",
          )}
          style={{ width: `${fillPct}%` }}
        />
        <div
          className="absolute top-1/2 h-4 w-[2px] -translate-y-1/2 bg-text-faint"
          style={{ left: `${targetMarkerPct}%` }}
          title={`Target: ${targetPct}%`}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[12px] text-text-faint">
        <span>{domainMin.toFixed(0)}%</span>
        {delta !== null && (
          <span
            className={cn(
              "flex items-center gap-1 font-mono font-medium",
              meetsTarget ? "text-success" : "text-danger",
            )}
          >
            {formatSignedPct(delta)} vs target
          </span>
        )}
        <span>100%</span>
      </div>
    </div>
  );
}
