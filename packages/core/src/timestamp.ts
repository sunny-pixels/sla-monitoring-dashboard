/**
 * Timestamp normalization — the fix for I1 (docs/data-audit.md §2), the
 * single highest-impact issue in the dataset. Three encodings appear mixed
 * in one column:
 *
 *   - ISO 8601 UTC:            2025-05-13T12:45:00Z
 *   - ISO 8601 with offset:    2025-05-13T02:00:00+05:30
 *   - Unix epoch seconds:      1746938700
 *
 * A naive parser that truncates the offset or ignores bare integers was
 * measured to drop 70-233 rows and open 86-295 phantom gaps per file (see
 * the audit). Every branch below is therefore explicit rather than left to
 * a generic date-parsing library, whose timezone behavior differs subtly
 * across environments (browser vs Node vs Workers) for the naive-datetime
 * case in particular.
 */

export type TimestampFormat = "iso_z" | "iso_offset" | "epoch_s" | "epoch_ms" | "naive" | "invalid";

export interface ParsedTimestamp {
  date: Date | null;
  format: TimestampFormat;
}

const ISO_Z = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
const ISO_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([+-])(\d{2}):?(\d{2})$/;
const ISO_NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const EPOCH_S = /^\d{10}$/;
const EPOCH_MS = /^\d{13}$/;

/**
 * Validates that field components form a real calendar date/time (rejecting
 * e.g. month 13 or hour 99) before computing epoch millis, rather than
 * letting `Date.UTC` silently roll invalid values over into a different,
 * plausible-looking date.
 */
function componentsAreValid(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 60) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d >= 1 && d <= daysInMonth;
}

/** Days-in-month aware epoch-millis computation from UTC field components. */
function utcMillis(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

export function parseTimestamp(raw: string): ParsedTimestamp {
  const v = raw.trim();
  if (v === "") return { date: null, format: "invalid" };

  let m = ISO_Z.exec(v);
  if (m) {
    const [, y, mo, d, h, mi, s] = m as unknown as string[];
    if (!componentsAreValid(+y!, +mo!, +d!, +h!, +mi!, +s!)) return { date: null, format: "invalid" };
    return {
      date: new Date(utcMillis(+y!, +mo!, +d!, +h!, +mi!, +s!)),
      format: "iso_z",
    };
  }

  m = ISO_OFFSET.exec(v);
  if (m) {
    const [, y, mo, d, h, mi, s, sign, oh, om] = m as unknown as string[];
    if (!componentsAreValid(+y!, +mo!, +d!, +h!, +mi!, +s!) || +oh! > 23 || +om! > 59) {
      return { date: null, format: "invalid" };
    }
    const offsetMinutes = (+oh! * 60 + +om!) * (sign === "-" ? -1 : 1);
    const asUtc = utcMillis(+y!, +mo!, +d!, +h!, +mi!, +s!) - offsetMinutes * 60_000;
    return { date: new Date(asUtc), format: "iso_offset" };
  }

  if (EPOCH_S.test(v)) {
    return { date: new Date(Number(v) * 1000), format: "epoch_s" };
  }

  if (EPOCH_MS.test(v)) {
    return { date: new Date(Number(v)), format: "epoch_ms" };
  }

  // Not observed in the supplied fixtures, but a naive "YYYY-MM-DD HH:MM:SS"
  // (no zone) is plausible in an arbitrary future upload. Treated as UTC
  // rather than the host machine's local zone, so behavior is deterministic
  // regardless of where the Worker or test runner executes.
  m = ISO_NAIVE.exec(v);
  if (m) {
    const [, y, mo, d, h, mi, s] = m as unknown as string[];
    if (!componentsAreValid(+y!, +mo!, +d!, +h!, +mi!, +s!)) return { date: null, format: "invalid" };
    return {
      date: new Date(utcMillis(+y!, +mo!, +d!, +h!, +mi!, +s!)),
      format: "naive",
    };
  }

  return { date: null, format: "invalid" };
}
