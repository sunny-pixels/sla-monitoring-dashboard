import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "success" | "warning" | "danger" | "neutral" | "accent";

const toneClasses: Record<Tone, string> = {
  success: "bg-success-soft text-success border-success-border",
  warning: "bg-warning-soft text-warning border-warning-border",
  danger: "bg-danger-soft text-danger border-danger-border",
  neutral: "bg-neutral-soft text-text-muted border-border",
  accent: "bg-accent-soft text-accent-text border-accent/20",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none",
        toneClasses[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
