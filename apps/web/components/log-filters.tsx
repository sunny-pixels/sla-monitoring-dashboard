"use client";

import { useEffect, useState } from "react";
import { Filter, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface LogFilterValues {
  mode: "date" | "range";
  date: string; // YYYY-MM-DD
  from: string;
  to: string;
  service: string; // "" = all
  status: "" | "success" | "failed" | "invalid";
}

export const EMPTY_FILTERS: LogFilterValues = {
  mode: "date",
  date: "",
  from: "",
  to: "",
  service: "",
  status: "",
};

export function LogFilters({
  services,
  value,
  onApply,
  onClear,
  totalShown,
  totalMatching,
}: {
  services: string[];
  value: LogFilterValues;
  onApply: (filters: LogFilterValues) => void;
  onClear: () => void;
  totalShown: number;
  totalMatching: number;
}) {
  const [draft, setDraft] = useState<LogFilterValues>(value);

  useEffect(() => setDraft(value), [value]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(value);
  const hasActiveFilters =
    value.date !== "" || value.from !== "" || value.to !== "" || value.service !== "" || value.status !== "";

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-[12px]">
          <button
            className={cn(
              "rounded px-2.5 py-1 font-medium transition-colors",
              draft.mode === "date" ? "bg-accent text-white" : "text-text-muted hover:text-text",
            )}
            onClick={() => setDraft((d) => ({ ...d, mode: "date" }))}
            type="button"
          >
            Single date
          </button>
          <button
            className={cn(
              "rounded px-2.5 py-1 font-medium transition-colors",
              draft.mode === "range" ? "bg-accent text-white" : "text-text-muted hover:text-text",
            )}
            onClick={() => setDraft((d) => ({ ...d, mode: "range" }))}
            type="button"
          >
            Date range
          </button>
        </div>

        {draft.mode === "date" ? (
          <Field label="Date">
            <input
              type="date"
              id="log-filter-date"
              name="date"
              value={draft.date}
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
              className={inputClass}
              aria-label="Filter by single date"
            />
          </Field>
        ) : (
          <>
            <Field label="From">
              <input
                type="date"
                id="log-filter-from"
                name="from"
                value={draft.from}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                className={inputClass}
                aria-label="Range start date"
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                id="log-filter-to"
                name="to"
                value={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                className={inputClass}
                aria-label="Range end date"
              />
            </Field>
          </>
        )}

        <Field label="Service">
          <select
            id="log-filter-service"
            name="service"
            value={draft.service}
            onChange={(e) => setDraft((d) => ({ ...d, service: e.target.value }))}
            className={inputClass}
            aria-label="Filter by service"
          >
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status">
          <select
            id="log-filter-status"
            name="status"
            value={draft.status}
            onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as LogFilterValues["status"] }))}
            className={inputClass}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="invalid">Invalid</option>
          </select>
        </Field>

        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={() => onApply(draft)} disabled={!isDirty}>
            <Filter className="h-3.5 w-3.5" />
            Apply
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              onClear();
            }}
            disabled={!hasActiveFilters && !isDirty}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[12px] text-text-faint">
        <Search className="h-3.5 w-3.5" />
        Showing {totalShown.toLocaleString()} of {totalMatching.toLocaleString()} checks
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-faint">{label}</span>
      {children}
    </label>
  );
}

const inputClass = cn(
  "h-9 rounded-md border border-border bg-surface-raised px-2.5 text-[13px] text-text",
  "hover:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
);
