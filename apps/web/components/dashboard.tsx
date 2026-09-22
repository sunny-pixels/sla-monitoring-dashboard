"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LogRowDto, StatsResponseDto, UploadSummaryDto } from "@sla/core";
import { DashboardHeader, type ApiStatus } from "@/components/dashboard-header";
import { SlaOverview } from "@/components/sla-overview";
import { LogFilters, EMPTY_FILTERS, type LogFilterValues } from "@/components/log-filters";
import { LogTable } from "@/components/log-table";
import { UploadDialog } from "@/components/upload-dialog";
import { EmptyState } from "@/components/empty-state";
import * as api from "@/lib/api-client";
import { ApiError, NetworkUnavailableError } from "@/lib/api-client";

const SLA_TARGET = Number(process.env.NEXT_PUBLIC_SLA_TARGET ?? "99.9");
const PAGE_SIZE = 50;

function friendlyError(err: unknown): string {
  if (err instanceof NetworkUnavailableError) return err.message;
  if (err instanceof ApiError) {
    if (err.code === "NOT_CONFIGURED") return err.message;
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

/** date-only "YYYY-MM-DD" -> next-day-midnight ISO, so a "to" filter includes the whole day. */
function toExclusiveEndIso(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export function Dashboard() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [datasets, setDatasets] = useState<UploadSummaryDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);

  const [stats, setStats] = useState<StatsResponseDto | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [filters, setFilters] = useState<LogFilterValues>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<LogRowDto[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadDatasets = useCallback(async (preferId?: string) => {
    setDatasetsLoading(true);
    setDatasetsError(null);
    try {
      await api.checkHealth();
      setApiStatus("operational");
      const list = await api.listDatasets();
      setDatasets(list);
      setSelectedId((current) => preferId ?? current ?? list[0]?.id ?? null);
    } catch (err) {
      setApiStatus(err instanceof NetworkUnavailableError ? "unreachable" : "operational");
      setDatasetsError(friendlyError(err));
    } finally {
      setDatasetsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDatasets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadStats = useCallback(async (uploadId: string) => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const s = await api.getStats(uploadId);
      setStats(s);
    } catch (err) {
      setStatsError(friendlyError(err));
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async (uploadId: string, f: LogFilterValues, p: number) => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const res = await api.getLogs(uploadId, {
        page: p,
        pageSize: PAGE_SIZE,
        date: f.mode === "date" && f.date ? f.date : undefined,
        from: f.mode === "range" && f.from ? `${f.from}T00:00:00.000Z` : undefined,
        to: f.mode === "range" && f.to ? toExclusiveEndIso(f.to) : undefined,
        service: f.service || undefined,
        status: f.status || undefined,
      });
      setLogs(res.data);
      setLogsTotal(res.pagination.total);
    } catch (err) {
      setLogsError(friendlyError(err));
      setLogs([]);
      setLogsTotal(0);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setStats(null);
      setLogs([]);
      setLogsTotal(0);
      return;
    }
    loadStats(selectedId);
    loadLogs(selectedId, filters, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function handleApplyFilters(next: LogFilterValues) {
    setFilters(next);
    setPage(1);
    if (selectedId) loadLogs(selectedId, next, 1);
  }

  function handleClearFilters() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
    if (selectedId) loadLogs(selectedId, EMPTY_FILTERS, 1);
  }

  function handlePageChange(next: number) {
    setPage(next);
    if (selectedId) loadLogs(selectedId, filters, next);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadDatasets(selectedId ?? undefined);
    if (selectedId) {
      await Promise.all([loadStats(selectedId), loadLogs(selectedId, filters, page)]);
    }
    setRefreshing(false);
  }

  function handleSelectDataset(id: string) {
    setSelectedId(id);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  function handleUploadComplete() {
    loadDatasets(); // re-selects the newest dataset once the list refreshes
  }

  // Derived from the currently loaded dataset's own stats — never a hardcoded
  // service list, so an arbitrary uploaded CSV's services populate correctly.
  const serviceIds = useMemo(() => (stats?.perService ?? []).map((s) => s.serviceId).sort(), [stats]);

  const hasActiveFilters = useMemo(
    () => filters.date !== "" || filters.from !== "" || filters.to !== "" || filters.service !== "" || filters.status !== "",
    [filters],
  );

  return (
    <div className="relative min-h-screen">
      <div className="grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[420px]" />

      <div className="relative">
        <DashboardHeader
          datasets={datasets}
          selectedId={selectedId}
          onSelect={handleSelectDataset}
          onUploadClick={() => setUploadOpen(true)}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          apiStatus={apiStatus}
        />

        <main className="mx-auto flex max-w-350 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
          {!datasetsLoading && datasets.length === 0 && !datasetsError && (
            <div className="rounded-xl border border-border bg-surface py-6 shadow-sm">
              <EmptyState variant="no-dataset" onAction={() => setUploadOpen(true)} />
            </div>
          )}

          {datasetsError && datasets.length === 0 && (
            <div className="rounded-xl border border-danger-border bg-danger-soft px-5 py-4 text-[13px] text-danger">
              {datasetsError}
            </div>
          )}

          {(datasetsLoading || datasets.length > 0) && (
            <>
              <SlaOverview stats={stats} loading={statsLoading} error={statsError} targetPct={SLA_TARGET} />

              <div className="flex flex-col gap-3">
                <h2 className="font-display text-lg font-semibold text-text">Health Check Logs</h2>

                <LogFilters
                  services={serviceIds}
                  value={filters}
                  onApply={handleApplyFilters}
                  onClear={handleClearFilters}
                  totalShown={logs.length}
                  totalMatching={logsTotal}
                />

                <LogTable
                  rows={logs}
                  loading={logsLoading}
                  error={logsError}
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={logsTotal}
                  onPageChange={handlePageChange}
                  onClearFilters={handleClearFilters}
                  hasActiveFilters={hasActiveFilters}
                />
              </div>
            </>
          )}
        </main>
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploadComplete={handleUploadComplete} />
    </div>
  );
}
