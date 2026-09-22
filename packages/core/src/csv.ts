/**
 * Minimal CSV line splitting and header resolution.
 *
 * The supplied fixtures never contain quoted fields or embedded commas (see
 * docs/data-audit.md §1), but a small amount of RFC4180 quote-handling is
 * included anyway since the application must accept "an arbitrary valid CSV
 * following the expected schema", not just these five files.
 *
 * Column order is resolved by name, not position — the schema is the header
 * row, not a fixed column layout — so `region,agent,...` in a different
 * order than the fixtures still works.
 */

import { REQUIRED_COLUMNS, type RawRow, type RequiredColumn } from "./types.js";

export interface ParsedCsvLine {
  lineNo: number;
  rawLine: string;
  fields: string[];
}

/** Splits one CSV line into fields, honoring double-quoted fields with escaped `""`. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/** Splits raw CSV text into logical lines, tolerant of CRLF, LF, and a trailing newline. */
export function splitLines(text: string): string[] {
  // Strip a single trailing newline so it doesn't produce a phantom blank line,
  // but preserve genuine blank lines elsewhere (they are counted and rejected).
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutTrailingNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (withoutTrailingNewline === "") return [];
  return withoutTrailingNewline.split("\n");
}

export interface HeaderResolution {
  ok: true;
  /** Maps each required column to its index in a data row's fields array. */
  columnIndex: Record<RequiredColumn, number>;
}

export interface HeaderResolutionError {
  ok: false;
  missingColumns: RequiredColumn[];
}

/** Resolves the header line against REQUIRED_COLUMNS, case-insensitively, order-independent. */
export function resolveHeader(headerLine: string): HeaderResolution | HeaderResolutionError {
  const fields = splitCsvLine(headerLine).map((f) => f.trim().toLowerCase());
  const columnIndex = {} as Record<RequiredColumn, number>;
  const missing: RequiredColumn[] = [];

  for (const col of REQUIRED_COLUMNS) {
    const idx = fields.indexOf(col);
    if (idx === -1) {
      missing.push(col);
    } else {
      columnIndex[col] = idx;
    }
  }

  if (missing.length > 0) return { ok: false, missingColumns: missing };
  return { ok: true, columnIndex };
}

/**
 * Parses one data line into a RawRow using a resolved header. Returns `null`
 * (rather than throwing) when the field count does not match the header —
 * the caller records this as a MALFORMED_ROW rejection rather than crashing
 * the whole chunk over one bad line.
 */
export function parseDataLine(
  fields: string[],
  columnIndex: Record<RequiredColumn, number>,
  expectedFieldCount: number,
): RawRow | null {
  if (fields.length !== expectedFieldCount) return null;
  const row = {} as RawRow;
  for (const col of REQUIRED_COLUMNS) {
    row[col] = (fields[columnIndex[col]] ?? "").trim();
  }
  return row;
}
