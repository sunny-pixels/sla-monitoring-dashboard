/** Formatting helpers — centralized so the table, stats, and dialogs render numbers consistently. */

const numberFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(n: number): string {
  return numberFormatter.format(n);
}

export function formatPct(n: number | null, digits = 2): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatSignedPct(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)} pp`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.round(ms)} ms`;
}

/** e.g. "Sep 21, 10:15:00" — compact, technical, unambiguous within a monitoring window. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).replace(",", ",") + " UTC";
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
