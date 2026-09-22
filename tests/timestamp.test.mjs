import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimestamp } from "@sla/core";

test("parses ISO 8601 UTC (the dominant fixture format)", () => {
  const { date, format } = parseTimestamp("2025-05-13T12:45:00Z");
  assert.equal(format, "iso_z");
  assert.equal(date.toISOString(), "2025-05-13T12:45:00.000Z");
});

test("converts a +05:30 offset to the correct UTC instant, not a truncated wall-clock", () => {
  const { date, format } = parseTimestamp("2025-05-13T02:00:00+05:30");
  assert.equal(format, "iso_offset");
  // 02:00 IST is 20:30 the PREVIOUS day in UTC — a naive truncation would
  // read this as 02:00 UTC, landing on the wrong day entirely.
  assert.equal(date.toISOString(), "2025-05-12T20:30:00.000Z");
});

test("converts a negative offset correctly", () => {
  const { date } = parseTimestamp("2025-05-13T02:00:00-05:00");
  assert.equal(date.toISOString(), "2025-05-13T07:00:00.000Z");
});

test("parses unix epoch seconds (10 digits)", () => {
  const { date, format } = parseTimestamp("1746938700");
  assert.equal(format, "epoch_s");
  assert.equal(date.toISOString(), "2025-05-11T04:45:00.000Z");
});

test("parses unix epoch milliseconds (13 digits)", () => {
  const { date, format } = parseTimestamp("1746938700000");
  assert.equal(format, "epoch_ms");
  assert.equal(date.toISOString(), "2025-05-11T04:45:00.000Z");
});

test("treats a naive 'YYYY-MM-DD HH:MM:SS' as UTC, not host-local time", () => {
  const { date, format } = parseTimestamp("2025-05-13 12:45:00");
  assert.equal(format, "naive");
  assert.equal(date.toISOString(), "2025-05-13T12:45:00.000Z");
});

test("rejects garbage and empty strings without throwing", () => {
  for (const bad of ["", "not-a-date", "2025-13-45T99:99:99Z", "   "]) {
    const { date, format } = parseTimestamp(bad);
    assert.equal(date, null, `expected null for ${JSON.stringify(bad)}`);
    assert.equal(format, "invalid");
  }
});
