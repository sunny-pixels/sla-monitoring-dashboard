import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

type Variant = "no-dataset" | "no-results";

const COPY: Record<Variant, { title: string; description: string; action: string }> = {
  "no-dataset": {
    title: "Upload your first monitoring dataset",
    description:
      "Upload a health-check CSV to calculate SLA availability and explore monitoring events.",
    action: "Upload CSV",
  },
  "no-results": {
    title: "No health checks found",
    description: "Try a different date range.",
    action: "Clear filters",
  },
};

export function EmptyState({ variant, onAction }: { variant: Variant; onAction?: () => void }) {
  const copy = COPY[variant];
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <EmptyIllustration />
      <div className="max-w-sm">
        <h3 className="font-display text-base font-semibold text-text">{copy.title}</h3>
        <p className="mt-1.5 text-[13px] text-text-muted">{copy.description}</p>
      </div>
      {onAction && (
        <Button variant={variant === "no-dataset" ? "primary" : "outline"} size="sm" onClick={onAction}>
          {variant === "no-dataset" && <Upload className="h-4 w-4" />}
          {copy.action}
        </Button>
      )}
    </div>
  );
}

function EmptyIllustration() {
  return (
    <svg width="88" height="64" viewBox="0 0 88 64" fill="none" aria-hidden="true">
      <rect x="8" y="10" width="72" height="44" rx="6" className="fill-surface-raised stroke-border" strokeWidth="1.5" />
      <path d="M16 40 L30 28 L40 34 L52 18 L64 26 L72 20" className="stroke-border-strong" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray="4 4" />
      <circle cx="72" cy="20" r="3" className="fill-accent" />
      <circle cx="30" cy="28" r="2.5" className="fill-text-faint" />
      <circle cx="52" cy="18" r="2.5" className="fill-text-faint" />
    </svg>
  );
}
