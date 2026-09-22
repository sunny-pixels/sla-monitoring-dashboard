"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDateShort, formatPct } from "@/lib/format";

interface DailyPoint {
  date: string;
  availabilityPct: number | null;
  validCheckpoints: number;
}

/**
 * The one chart in this dashboard: where outages fall across the monitored
 * range. A single number can't show that; this can, in the space of a
 * sparkline strip.
 */
export function DailyAvailabilityChart({ data, targetPct }: { data: DailyPoint[]; targetPct: number }) {
  if (data.length === 0) return null;

  return (
    <div className="h-[72px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[95, 100]} />
          <Tooltip
            cursor={{ fill: "var(--color-neutral-soft)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as DailyPoint;
              return (
                <div className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-md">
                  <div className="font-medium text-text">{formatDateShort(point.date)}</div>
                  <div className="font-mono text-text-muted">
                    {formatPct(point.availabilityPct)} · {point.validCheckpoints} checks
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="availabilityPct" radius={[2, 2, 0, 0]} maxBarSize={14}>
            {data.map((d) => (
              <Cell
                key={d.date}
                fill={
                  d.availabilityPct === null
                    ? "var(--color-neutral)"
                    : d.availabilityPct >= targetPct
                      ? "var(--color-success)"
                      : "var(--color-danger)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
