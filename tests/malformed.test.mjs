/**
 * The audit found the supplied fixtures well-formed enough that zero rows
 * are ever rejected (docs/data-audit.md §6). These tests cover the paths
 * that never fire on the real fixtures but must still behave correctly on
 * an arbitrary uploaded CSV, per the assignment's testing requirements.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { processCsvText, SchemaValidationError } from "@sla/core";

const HEADER = "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region";

test("empty file: no rows, no crash", () => {
  const result = processCsvText("");
  assert.equal(result.rowsReceived, 0);
  assert.equal(result.cleaned.length, 0);
  assert.equal(result.rejected.length, 0);
});

test("header-only file: no data rows, no crash", () => {
  const result = processCsvText(HEADER + "\n");
  assert.equal(result.rowsReceived, 0);
  assert.equal(result.cleaned.length, 0);
});

test("missing required column is a whole-file schema error, not a per-row rejection", () => {
  const badHeader = "service_id,service_name,timestamp,latency,latency_unit,agent,region"; // no status_code
  assert.throws(
    () => processCsvText(badHeader + "\nsvc-auth,auth-api,2025-01-01T00:00:00Z,100,ms,agent-1,ap-south-1"),
    (err) => {
      assert.ok(err instanceof SchemaValidationError);
      assert.deepEqual(err.missingColumns, ["status_code"]);
      return true;
    },
  );
});

test("column order does not matter — header is resolved by name", () => {
  const reordered = "region,agent,latency_unit,latency,status_code,timestamp,service_name,service_id";
  const row = "ap-south-1,agent-1,ms,150,200,2025-01-01T00:00:00Z,auth-api,svc-auth";
  const result = processCsvText(reordered + "\n" + row);
  assert.equal(result.cleaned.length, 1);
  assert.equal(result.cleaned[0].serviceId, "svc-auth");
  assert.equal(result.cleaned[0].latencyMs, 150);
});

test("unparseable timestamp is rejected with a clear reason, row is not silently dropped", () => {
  const row = "svc-auth,auth-api,not-a-timestamp,200,150,ms,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.cleaned.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "INVALID_TIMESTAMP");
  assert.equal(result.rejected[0].rawLine, row);
});

test("non-numeric status code is rejected", () => {
  const row = "svc-auth,auth-api,2025-01-01T00:00:00Z,OK,150,ms,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "INVALID_STATUS_CODE");
});

test("blank required field (service_id) is rejected", () => {
  const row = ",auth-api,2025-01-01T00:00:00Z,200,150,ms,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "MISSING_REQUIRED_FIELD");
  assert.equal(result.rejected[0].field, "service_id");
});

test("ragged row (wrong field count) is rejected as malformed, not crashed on", () => {
  const row = "svc-auth,auth-api,2025-01-01T00:00:00Z,200,150,ms,agent-1"; // missing region
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "MALFORMED_ROW");
});

test("negative latency is nulled but the row (and its status) is kept — I5", () => {
  const row = "svc-reports,reports-api,2025-01-01T00:00:00Z,200,-286,ms,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.cleaned.length, 1);
  assert.equal(result.cleaned[0].latencyMs, null);
  assert.equal(result.cleaned[0].statusCode, 200);
  assert.equal(result.cleaned[0].isSuccess, true);
});

test("empty latency is nulled but the row is kept — I7", () => {
  const row = "svc-notify,notify-worker,2025-01-01T00:00:00Z,200,,ms,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.cleaned[0].latencyMs, null);
});

test("non-numeric latency is nulled but the row is kept", () => {
  const row = "svc-notify,notify-worker,2025-01-01T00:00:00Z,200,N/A,ms,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.cleaned[0].latencyMs, null);
});

test("a huge (but positive) latency is kept unclipped — I8", () => {
  const row = "svc-reports,reports-api,2025-01-01T00:00:00Z,200,999999,ms,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.cleaned[0].latencyMs, 999999);
});

test("status 999 is kept, flagged invalid, and excluded from success — I3", () => {
  const row = "svc-search,search-api,2025-01-01T00:00:00Z,999,0.6,s,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.cleaned[0].statusValid, false);
  assert.equal(result.cleaned[0].isSuccess, false);
  assert.equal(result.cleaned[0].statusCode, 999);
});

test("latency in seconds is normalized to milliseconds — I4", () => {
  const row = "svc-search,search-api,2025-01-01T00:00:00Z,200,0.717,s,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.cleaned[0].latencyMs, 717);
});

test("byte-exact duplicate rows are removed, keeping one", () => {
  const row = "svc-auth,auth-api,2025-01-01T00:00:00Z,200,150,ms,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row + "\n" + row + "\n" + row);
  assert.equal(result.rowsReceived, 3);
  assert.equal(result.exactDuplicatesRemoved, 2);
  assert.equal(result.cleaned.length, 1);
});

test("blank lines mid-file are skipped, not counted or rejected", () => {
  const row = "svc-auth,auth-api,2025-01-01T00:00:00Z,200,150,ms,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row + "\n\n" + row.replace("00:00:00", "00:15:00"));
  assert.equal(result.rowsReceived, 2);
  assert.equal(result.cleaned.length, 2);
});

test("a 5xx status is a failure but still a valid, countable observation", () => {
  const row = "svc-payments,payments-api,2025-01-01T00:00:00Z,503,300,ms,agent-1,ap-south-1";
  const result = processCsvText(HEADER + "\n" + row);
  assert.equal(result.cleaned[0].statusValid, true);
  assert.equal(result.cleaned[0].isSuccess, false);
});
