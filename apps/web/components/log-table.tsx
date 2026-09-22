import { CheckCircle, ChevronLeft, ChevronRight, HelpCircle, XCircle } from "lucide-react";
import type { LogRowDto } from "@sla/core";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { formatLatency, formatTimestamp } from "@/lib/format";

export function LogTable({
  rows,
  loading,
  error,
  page,
  pageSize,
  total,
  onPageChange,
  onClearFilters,
  hasActiveFilters,
}: {
  rows: LogRowDto[];
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface-raised">
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-text-faint">
              <th className="px-4 py-2.5 font-semibold">Timestamp</th>
              <th className="px-4 py-2.5 font-semibold">Service</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 text-right font-semibold">Latency</th>
              <th className="px-4 py-2.5 font-semibold">Agent</th>
              <th className="px-4 py-2.5 font-semibold">Region</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-danger">
                  {error}
                </td>
              </tr>
            )}

            {!error && loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full max-w-[140px]" />
                    </td>
                  ))}
                </tr>
              ))}

            {!error && !loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12">
                  <EmptyState
                    variant="no-results"
                    onAction={hasActiveFilters ? onClearFilters : undefined}
                  />
                </td>
              </tr>
            )}

            {!error &&
              !loading &&
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors hover:bg-neutral-soft/60">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12.5px] text-text-muted">
                    {formatTimestamp(row.checkedAt)}
                  </td>
                  <td className="px-4 py-2.5 text-text">{row.serviceName}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge row={row} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12.5px] text-text-muted">
                    {formatLatency(row.latencyMs)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12.5px] text-text-muted">{row.agent}</td>
                  <td className="px-4 py-2.5 font-mono text-[12.5px] text-text-muted">{row.region}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {!error && total > 0 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <span className="text-[12px] text-text-faint">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || loading}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || loading}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ row }: { row: LogRowDto }) {
  if (!row.statusValid) {
    return (
      <Badge tone="warning" icon={<HelpCircle className="h-3 w-3" />}>
        [{row.statusCode}] Invalid
      </Badge>
    );
  }
  if (row.isSuccess) {
    return (
      <Badge tone="success" icon={<CheckCircle className="h-3 w-3" />}>
        [{row.statusCode}] Success
      </Badge>
    );
  }
  return (
    <Badge tone="danger" icon={<XCircle className="h-3 w-3" />}>
      [{row.statusCode}] Failed
    </Badge>
  );
}
