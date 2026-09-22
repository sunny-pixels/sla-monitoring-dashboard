import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export function StatItem({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "default" | "danger" | "warning";
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-text-faint",
        )}
      />
      <div className="min-w-0">
        <div className="truncate font-mono text-[15px] font-semibold leading-tight text-text">{value}</div>
        <div className="truncate text-[12px] leading-tight text-text-muted">{label}</div>
      </div>
    </div>
  );
}
