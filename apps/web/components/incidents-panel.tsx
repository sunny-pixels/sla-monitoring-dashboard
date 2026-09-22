import { AlertTriangle } from "lucide-react";
import type { IncidentDto } from "@sla/core";
import { Badge } from "@/components/ui/badge";
import { formatDuration, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/cn";

const SEVERITY_TONE = {
  critical: "danger",
  major: "warning",
  minor: "neutral",
} as const;

export function IncidentsPanel({ incidents }: { incidents: IncidentDto[] }) {
  if (incidents.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] text-text-muted">
        <AlertTriangle className="h-4 w-4 shrink-0 text-text-faint" />
        No incidents detected from persisted checks in this range.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {incidents.map((inc, i) => (
        <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              className={cn(
                "h-4 w-4 shrink-0",
                inc.severity === "critical" ? "text-danger" : inc.severity === "major" ? "text-warning" : "text-text-faint",
              )}
            />
            <div>
              <div className="text-[13px] font-medium text-text">{inc.serviceId}</div>
              <div className="font-mono text-[12px] text-text-muted">
                {formatTimestamp(inc.startedAt)} → {formatTimestamp(inc.endedAt)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-text-muted">
              {inc.failedChecks} checks · {formatDuration(inc.durationMinutes)}
            </span>
            <Badge tone={SEVERITY_TONE[inc.severity]}>{inc.severity}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
