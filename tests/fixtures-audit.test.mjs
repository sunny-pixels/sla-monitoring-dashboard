/**
 * These tests are the proof behind docs/data-audit.md. Every expected number
 * below was measured from the raw fixtures with an independent pandas
 * analysis before packages/core was written (see the audit doc for the full
 * methodology). If this file passes, the shipped pipeline reproduces those
 * measurements exactly — the audit document cannot silently drift from what
 * the code actually does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { processCsvText, collapseToCheckpoints, computeSlaStats, deriveIncidents } from "@sla/core";
import { readFixture, findIssue } from "./helpers.mjs";

// Measured directly from the raw CSVs (docs/data-audit.md §1-§2).
const FIXTURES = [
  {
    file: "monitoring_checks_9d_seed101.csv",
    rowsReceived: 4672,
    exactDuplicatesRemoved: 6,
    observerDuplicatesResolved: 1,
    isoOffsetCount: 32,
    epochCount: 70,
    latencyMissingCount: 56,
    validCheckpoints: 4319,
    successfulCheckpoints: 4278,
    expectedCheckpoints: 4320,
    incidents: [{ serviceId: "svc-reports", failedChecks: 6 }],
  },
  {
    file: "monitoring_checks_12d_seed505.csv",
    rowsReceived: 6230,
    exactDuplicatesRemoved: 8,
    observerDuplicatesResolved: 2,
    isoOffsetCount: 43,
    epochCount: 93,
    latencyMissingCount: 74,
    validCheckpoints: 5759,
    successfulCheckpoints: 5682,
    expectedCheckpoints: 5760,
    incidents: [{ serviceId: "svc-search", failedChecks: 16 }],
  },
  {
    file: "monitoring_checks_14d_seed202.csv",
    rowsReceived: 7269,
    exactDuplicatesRemoved: 10,
    observerDuplicatesResolved: 2,
    isoOffsetCount: 50,
    epochCount: 109,
    latencyMissingCount: 87,
    validCheckpoints: 6720,
    successfulCheckpoints: 6615,
    expectedCheckpoints: 6720,
    incidents: [
      { serviceId: "svc-notify", failedChecks: 16 },
      { serviceId: "svc-notify", failedChecks: 8 },
      { serviceId: "svc-reports", failedChecks: 4 }, // documented false positive, see audit §4
    ],
  },
  {
    file: "monitoring_checks_21d_seed303.csv",
    rowsReceived: 10904,
    exactDuplicatesRemoved: 18,
    observerDuplicatesResolved: 0,
    isoOffsetCount: 76,
    epochCount: 163,
    latencyMissingCount: 130,
    validCheckpoints: 10079,
    successfulCheckpoints: 9955,
    expectedCheckpoints: 10080,
    incidents: [{ serviceId: "svc-payments", failedChecks: 16 }],
  },
  {
    file: "monitoring_checks_30d_seed404.csv",
    rowsReceived: 15577,
    exactDuplicatesRemoved: 24,
    observerDuplicatesResolved: 1,
    isoOffsetCount: 109,
    epochCount: 233,
    latencyMissingCount: 186,
    validCheckpoints: 14399,
    successfulCheckpoints: 14217,
    expectedCheckpoints: 14400,
    incidents: [
      { serviceId: "svc-auth", failedChecks: 18 },
      { serviceId: "svc-reports", failedChecks: 7 },
    ],
  },
];

for (const fx of FIXTURES) {
  test(`${fx.file}: row counts and dedup match the measured audit`, () => {
    const text = readFixture(fx.file);
    const result = processCsvText(text);

    assert.equal(result.rowsReceived, fx.rowsReceived, "rowsReceived");
    assert.equal(result.rejected.length, 0, "no rows should be rejected in these fixtures");
    assert.equal(result.exactDuplicatesRemoved, fx.exactDuplicatesRemoved, "exactDuplicatesRemoved");
    assert.equal(result.observerDuplicatesResolved, fx.observerDuplicatesResolved, "observerDuplicatesResolved");
    assert.equal(
      result.cleaned.length,
      fx.rowsReceived - fx.exactDuplicatesRemoved - fx.observerDuplicatesResolved,
      "cleaned row count",
    );
  });

  test(`${fx.file}: quality issues match the measured audit (I1, I3, I5, I7)`, () => {
    const { issues } = processCsvText(readFixture(fx.file));

    assert.equal(findIssue(issues, "TIMESTAMP_NORMALIZED_OFFSET")?.count, fx.isoOffsetCount, "I1 offset count");
    assert.equal(findIssue(issues, "TIMESTAMP_NORMALIZED_EPOCH")?.count, fx.epochCount, "I1 epoch count");
    assert.equal(findIssue(issues, "STATUS_CODE_INVALID")?.count, 1, "I3: exactly one 999 per file");
    assert.equal(findIssue(issues, "LATENCY_NEGATIVE")?.count, 1, "I5: exactly one negative latency per file");
    assert.equal(findIssue(issues, "LATENCY_MISSING")?.count, fx.latencyMissingCount, "I7 empty latency count");
  });

  test(`${fx.file}: check-point SLA availability matches the measured audit`, () => {
    const { cleaned } = processCsvText(readFixture(fx.file));
    const stats = computeSlaStats(cleaned);

    assert.equal(stats.intervalSeconds, 900, "inferred 15-minute cadence");
    assert.equal(stats.validCheckpoints, fx.validCheckpoints, "validCheckpoints");
    assert.equal(stats.successfulCheckpoints, fx.successfulCheckpoints, "successfulCheckpoints");
    assert.equal(stats.expectedCheckpoints, fx.expectedCheckpoints, "expectedCheckpoints (grid size)");

    const expectedAvailability = Math.round((10000 * fx.successfulCheckpoints) / fx.validCheckpoints) / 100;
    assert.ok(
      Math.abs(stats.availabilityPct - expectedAvailability) < 0.01,
      `availability ${stats.availabilityPct}% should match measured ${expectedAvailability}%`,
    );
    assert.ok(stats.availabilityPct < 99.9, "every fixture breaches the 99.9% SLA target");
  });

  test(`${fx.file}: incident detection reproduces the injected outages (validated against the JSON oracle)`, () => {
    const { cleaned } = processCsvText(readFixture(fx.file));
    const checkpoints = collapseToCheckpoints(cleaned);
    const incidents = deriveIncidents(checkpoints, 900);

    assert.equal(incidents.length, fx.incidents.length, "incident count");
    for (const expected of fx.incidents) {
      const match = incidents.find(
        (inc) => inc.serviceId === expected.serviceId && inc.failedChecks === expected.failedChecks,
      );
      assert.ok(match, `expected an incident on ${expected.serviceId} with ${expected.failedChecks} failed checks`);
    }
  });
}

test("agent-2 is fully redundant: every dataset has zero sole-observer agent-2 slots", () => {
  for (const fx of FIXTURES) {
    const { cleaned } = processCsvText(readFixture(fx.file));
    const agent1Slots = new Set(
      cleaned.filter((c) => c.agent === "agent-1").map((c) => `${c.serviceId}|${c.checkedAt.getTime()}`),
    );
    const agent2Only = cleaned.filter(
      (c) => c.agent === "agent-2" && !agent1Slots.has(`${c.serviceId}|${c.checkedAt.getTime()}`),
    );
    assert.equal(agent2Only.length, 0, `${fx.file}: agent-2 should never be the sole observer of a slot`);
  }
});
