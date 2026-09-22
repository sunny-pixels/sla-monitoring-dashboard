# Data Audit — supplied monitoring datasets

Every number in this document was measured from the supplied files before any application code was
written. Nothing here is estimated or assumed. The audit scripts that produced these figures are
reproduced by the test suite in [`tests/`](../tests), which asserts these exact values, so the
document cannot silently drift from the data.

**Files audited**

- `fixtures/monitoring_checks_9d_seed101.csv`
- `fixtures/monitoring_checks_12d_seed505.csv`
- `fixtures/monitoring_checks_14d_seed202.csv`
- `fixtures/monitoring_checks_21d_seed303.csv`
- `fixtures/monitoring_checks_30d_seed404.csv`
- `fixtures/dataset_incident_log.json`

> The CSVs were moved from the repository root into `fixtures/` during setup. They are **test
> fixtures**, not application configuration. Nothing in the application reads them, and no code path
> depends on their filenames — the app accepts any CSV matching the schema below.

---

## 1. Structure — what the files actually contain

All five CSVs share one schema. Header, in this order:

```
service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region
```

Structural properties, verified on every file:

| Property | Result |
|---|---|
| Encoding | ASCII, no BOM |
| Line endings | CRLF throughout |
| Ragged rows (field count ≠ 8) | **0** in all five files |
| Blank lines | **0** in all five files |
| Quoted / embedded-comma fields | none present |
| Header spelling | identical across all five files |

### Per-file totals

| | 9d_seed101 | 12d_seed505 | 14d_seed202 | 21d_seed303 | 30d_seed404 |
|---|---:|---:|---:|---:|---:|
| Data rows | 4,672 | 6,230 | 7,269 | 10,904 | 15,577 |
| File size (bytes) | 350,323 | 467,088 | 544,959 | 817,475 | 1,167,719 |
| Earliest timestamp (UTC) | 2025-05-08 00:00 | 2025-04-10 00:00 | 2025-05-19 00:00 | 2025-04-03 00:00 | 2025-04-06 00:00 |
| Latest timestamp (UTC) | 2025-05-16 23:45 | 2025-04-21 23:45 | 2025-06-01 23:45 | 2025-04-23 23:45 | 2025-05-05 23:45 |
| **Actual days covered** | **9** | **12** | **14** | **21** | **30** |
| Unique services | 5 | 5 | 5 | 5 | 5 |
| Unique agents | 2 | 2 | 2 | 2 | 2 |
| Unique regions | 1 | 1 | 1 | 1 | 1 |
| Distinct timestamps | 960 | 1,284 | 1,500 | 2,249 | 3,213 |

The day counts match the `9d/12d/14d/21d/30d` filename hints, but they were **derived from the
timestamp column**, not from the filename. The application infers coverage the same way and hardcodes
no duration.

### Dimensions

| Dimension | Values |
|---|---|
| `service_id` → `service_name` | `svc-auth`→`auth-api`, `svc-notify`→`notify-worker`, `svc-payments`→`payments-api`, `svc-reports`→`reports-api`, `svc-search`→`search-api` |
| `agent` | `agent-1`, `agent-2` |
| `region` | `ap-south-1` — **the only value in all five files** |

The `service_id` → `service_name` mapping is a clean 1:1 in every file; there is not a single row
where a service id maps to an unexpected name. There are **no unexpected service, agent or region
values** anywhere, and **no missing values** in `service_id`, `service_name`, `timestamp`,
`status_code`, `latency_unit`, `agent` or `region`. The only column with empty values is `latency`
(issue **I7**).

Because `region` has cardinality 1, a "regions monitored" statistic would display `1` for every
dataset. The dashboard therefore reports **agents** as the observer dimension and treats region as a
record attribute only. This is a design consequence of the data, not an oversight.

### Cadence and grid alignment

Every timestamp in every file falls exactly on a `:00`, `:15`, `:30` or `:45` boundary with zero
seconds — **0 misaligned timestamps** across all 44,652 rows. The check cadence is therefore
15 minutes per service, giving 96 check-points per service per day.

| | 9d | 12d | 14d | 21d | 30d |
|---|---:|---:|---:|---:|---:|
| 15-min slots in range | 864 | 1,152 | 1,344 | 2,016 | 2,880 |
| × 5 services = expected check-points | 4,320 | 5,760 | 6,720 | 10,080 | 14,400 |
| **Check-points with no observation** | **0** | **0** | **0** | **0** | **0** |

The application **infers** this cadence from the modal inter-check interval per service rather than
assuming 15 minutes, so a CSV recorded at any other interval is handled correctly.

---

## 2. Issue register

Severity reflects impact on the reported availability figure, since that figure decides billing
credits.

---

### I1 — Mixed timestamp encodings · **CRITICAL**

**Datasets:** all five.

The `timestamp` column contains three different encodings mixed together:

| Encoding | Example | 9d | 12d | 14d | 21d | 30d |
|---|---|---:|---:|---:|---:|---:|
| ISO 8601 UTC | `2025-05-13T12:45:00Z` | 4,570 | 6,094 | 7,110 | 10,665 | 15,235 |
| ISO 8601 with `+05:30` offset | `2025-05-13T02:00:00+05:30` | 32 | 43 | 50 | 76 | 109 |
| Unix epoch seconds | `1746938700` | 70 | 93 | 109 | 163 | 233 |

There are no other formats, and **no unparseable timestamps** once all three are handled.

**Why this is the most dangerous issue in the data.** A plausible-but-naive parser — one that
truncates the offset to take the wall-clock portion, and does not recognise bare integers — was
measured against each file:

| | 9d | 12d | 14d | 21d | 30d |
|---|---:|---:|---:|---:|---:|
| Rows silently dropped (epoch unrecognised) | 70 | 93 | 109 | 163 | 233 |
| **Phantom gaps opened in the 15-min grid** | **86** | **116** | **137** | **202** | **295** |
| Timestamps thrown outside the dataset range | 0 | 0 | 1 | 2 | 0 |

Compared with correct parsing: **0 rows dropped, 0 gaps** in every file.

Between 89 and 297 check-points per file have a non-`...Z` timestamp as their **only**
representation, so mis-parsing them does not merely relabel a row — it erases that check-point from
coverage entirely.

**Handling.** Normalize all three encodings to a single UTC `timestamptz`. The `+05:30` values are
the *same instant* expressed in IST and are converted, never truncated. Epoch seconds (10-digit) and
epoch milliseconds (13-digit) are both recognised.

**Reasoning.** An offset-bearing timestamp that is truncated shifts by 5h30m, which moves the
observation to a different check-point and usually a different day — corrupting both the availability
denominator and every date filter. Dropping epoch rows would silently discard up to 1.5% of the
evidence. Neither failure announces itself: the totals still look plausible. This is exactly the
class of bug that makes an automated billing pipeline untrustworthy, so it is handled first and
covered by explicit regression tests.

---

### I2 — `agent-2` is a redundant observer, not additional coverage · **HIGH**

**Datasets:** all five.

| | 9d | 12d | 14d | 21d | 30d |
|---|---:|---:|---:|---:|---:|
| `agent-1` rows | 4,327 | 5,770 | 6,732 | 10,098 | 14,424 |
| `agent-2` rows | 345 | 460 | 537 | 806 | 1,153 |
| `agent-2` rows landing on a slot `agent-1` already covered | **345/345** | **460/460** | **537/537** | **806/806** | **1,153/1,153** |

Every single `agent-2` observation duplicates a `(service, 15-min slot)` that `agent-1` already
reported. `agent-2` never covers a check-point alone. So roughly 7–8% of check-points carry two
observations and the rest carry one.

**Handling.** Availability is computed per **check-point** — one `(service, 15-minute slot)` — and
not per raw row. Where a check-point has several observations they collapse to one outcome, worst
observation winning. Both raw observations are still persisted and both are visible in the logs
table.

**Reasoning.** Counting raw rows would weight the 7–8% double-observed check-points twice, making the
contractual availability figure depend on how many agents happened to probe rather than on whether
the service was up. Measured effect of the choice, per-observation vs per-check-point:
99.035%/99.051% (9d), 98.682%/98.663% (12d), 98.484%/98.438% (14d), 98.797%/98.770% (21d),
98.765%/98.736% (30d) — differences of up to 0.046 percentage points. Small, but this number decides
money, and "how many agents probed" is not a property of service health.

---

### I3 — Status code `999` is a probe artifact, not a service failure · **HIGH**

**Datasets:** all five — **exactly one row in each**.

| Dataset | Row |
|---|---|
| 9d | `svc-payments  2025-05-10T22:30:00Z  999  389 ms  agent-1` |
| 12d | `svc-auth      2025-04-16T19:00:00Z  999  116 ms  agent-1` |
| 14d | `svc-search    2025-05-31T11:00:00Z  999  0.632 s agent-1` |
| 21d | `svc-search    2025-04-04T20:00:00Z  999  0.566 s agent-1` |
| 30d | `svc-auth      2025-04-18T10:30:00Z  999  151 ms  agent-1` |

`999` is not a valid HTTP status code. One occurrence per file, a different service each time, never
adjacent to another failure and never part of a cluster — so it is not an outage signature.

**The decisive evidence** is in `14d_seed202`. At `2025-05-31T11:00:00Z`, `agent-1` reports `999`
for `svc-search` while **`agent-2` reports `200` for the same service at the same instant**, with a
near-identical latency (`0.632s` vs `0.638s`). That is the **only** check-point in all five files
where two observers disagree on status. The service was demonstrably up; the probe failed.

**Handling.** Codes outside the valid HTTP range `[100, 600)` are flagged `status_valid = false` and
**excluded from the SLA denominator** as inconclusive. They are never counted as successes. The row
is still persisted in full and rendered in the logs table with a distinct `Invalid` badge, so the
exclusion is visible rather than hidden.

**Reasoning.** An availability SLA measures whether the *service* responded, and a malformed status
is evidence that the *monitor* failed — a different fault. Counting it as downtime would bill a
provider for a broken probe; counting it as success would hide a genuine blind spot. Excluding it
while surfacing it as reduced coverage is the only option that misrepresents neither party.

**Measured consequence, reported honestly:** in 9d, 12d, 21d and 30d the `999` row is the *only*
observation for its check-point, so excluding it leaves exactly **1 check-point with no valid
observation** in each of those files. In 14d the `agent-2` row covers the same slot, so coverage
remains complete. These appear in the dashboard as missing coverage — never as successful checks.

| | 9d | 12d | 14d | 21d | 30d |
|---|---:|---:|---:|---:|---:|
| Check-points lacking a valid observation after excluding `999` | 1 | 1 | **0** | 1 | 1 |

---

### I4 — Latency unit varies by service · **HIGH**

**Datasets:** all five.

The `latency_unit` column contains only `ms` and `s`, and the split is perfectly aligned to service:

| Dataset | Rows in `s` | Service reporting in `s` |
|---|---:|---|
| 9d | 935 | `svc-search` (all 935 of its rows) |
| 12d | 1,242 | `svc-search` (all 1,242) |
| 14d | 1,452 | `svc-search` (all 1,452) |
| 21d | 2,184 | `svc-search` (all 2,184) |
| 30d | 3,131 | `svc-search` (all 3,131) |

`svc-search` reports seconds (`0.717`); every other service reports milliseconds (`707`). The
mapping is 100% consistent — there is no row where a service mixes units.

**Handling.** Normalize every latency to an integer millisecond value using the row's own
`latency_unit`, and store the original value and unit alongside it for traceability.

**Reasoning.** Unnormalized, `svc-search` appears ~1000× faster than every other service, which
would drag any cross-service latency average toward zero and make a p95 meaningless. Because the
unit is declared per row rather than inferred, the conversion is deterministic — no heuristics and no
guessing at magnitudes.

---

### I5 — Negative latency values · **MEDIUM**

**Datasets:** all five — **exactly one row in each**, and in every case on a `200` (successful) row.

| Dataset | Row |
|---|---|
| 9d | `svc-reports 2025-05-11T21:15:00Z 200 **-286** ms` |
| 12d | `svc-notify  2025-04-19T14:15:00Z 200 **-296** ms` |
| 14d | `svc-auth    2025-06-01T03:15:00Z 200 **-342** ms` |
| 21d | `svc-reports 2025-04-11T00:45:00Z 200 **-307** ms` |
| 30d | `svc-notify  2025-04-16T13:00:00Z 200 **-223** ms` |

**Handling.** Set `latency_ms` to `NULL`, **keep the row**, and record a quality issue. The original
value is preserved in `latency_raw`.

**Reasoning.** A negative duration is physically impossible, so the measurement is untrustworthy —
but the *status code* on the same row is a perfectly valid availability observation. Rejecting the
whole row to fix one bad field would remove a real check-point from the availability calculation,
letting a latency glitch corrupt the billing number. The row's availability contribution is kept; only
its latency contribution is discarded.

---

### I6 — Three distinct classes of duplicate · **MEDIUM**

**Datasets:** all five. These must not be conflated — only two of the three are actually duplicates.

| Class | 9d | 12d | 14d | 21d | 30d | Treatment |
|---|---:|---:|---:|---:|---:|---|
| **(a)** Byte-identical repeated rows | 6 | 8 | 10 | 18 | 24 | Remove |
| **(b)** Same `(service, slot, agent)`, **conflicting** values | 1 | 2 | 2 | 0 | 1 | Keep the most complete row |
| **(c)** Same `(service, slot)`, **different agent** | 345 | 460 | 537 | 806 | 1,153 | **Not a duplicate** — see I2 |

Class (b) is a genuine conflict rather than a repeat. In `14d_seed202`:

```
svc-payments 2025-06-01T12:00:00Z 200  269  ms agent-1
svc-payments 2025-06-01T12:00:00Z 200  ''   ms agent-1     ← same observation, latency missing
svc-reports  2025-06-01T12:00:00Z 200  ''   ms agent-1
svc-reports  2025-06-01T12:00:00Z 200  586  ms agent-1
```

Four check-points across the five files carry three rows (one `agent-1` pair plus one `agent-2`
observation), which is class (a) and class (c) occurring on the same slot.

**Handling.** Deduplicate on the logical key `(upload, service, checked_at, agent)`. Within a chunk,
conflicting rows are resolved by preferring the row with the most populated fields. The same key is
enforced as a `UNIQUE` constraint in Postgres, so the database is the final arbiter and a retried
upload chunk cannot double-insert. Class (c) is explicitly **not** collapsed at storage time — both
observations are preserved — and is instead collapsed at *calculation* time by I2's check-point rule.

**Reasoning.** A repeated monitoring observation is a transport artifact, not extra evidence of
health; leaving class (a) in would inflate the success count. But collapsing class (c) at storage
time would destroy the record that two agents independently observed the service, which is precisely
the evidence that resolved I3. Separating storage fidelity from calculation semantics keeps both.

*Known limitation, stated plainly:* because the upload is chunked, a class (b) conflict whose two
rows land in different chunks is resolved by first-arrival rather than by completeness. This affects
at most 2 rows per file and only the `latency_ms` field, never a status code, so it cannot move the
availability figure.

---

### I7 — Missing latency values · **MEDIUM**

**Datasets:** all five. `latency` is the only column that is ever empty.

| | 9d | 12d | 14d | 21d | 30d |
|---|---:|---:|---:|---:|---:|
| Empty `latency` | 56 | 74 | 87 | 130 | 186 |
| As % of rows | 1.20% | 1.19% | 1.20% | 1.19% | 1.19% |
| …of those, on a failed (`5xx`) row | 0 | 0 | **4** | **2** | 0 |

**Handling.** Store `latency_ms` as `NULL`, keep the row, and exclude it from latency aggregates
only — never from the availability calculation.

**Reasoning.** Same principle as I5: a missing latency does not invalidate the status observation. The
six cases that sit on `5xx` rows are consistent with a request that timed out or errored before a
duration could be recorded — which is exactly when you would *expect* no latency, and exactly the row
you least want to drop. Substituting zero would be worse still: it would pull the average down while
implying instant responses during an outage.

---

### I8 — Latency tail spikes · **LOW — signal, not corruption**

**Datasets:** all five. Per-service normalized latency (ms), showing the gap between p99 and max:

| Dataset | Service | p50 | p95 | p99 | max |
|---|---|---:|---:|---:|---:|
| 9d | `svc-reports` | 642 | 843 | 861 | **3,022** |
| 12d | `svc-search` | 538 | 710 | 1,934 | **2,452** |
| 21d | `svc-payments` | 373 | 484 | 902 | **1,696** |
| 30d | `svc-reports` | 655 | 846 | 862 | **2,865** |
| 30d | `svc-auth` | 143 | 188 | 196 | **660** |

**Handling.** Do not clip, cap or winsorize. Report p50, p95 and p99 rather than the mean alone.

**Reasoning.** These values are within physical possibility for an HTTP request and they cluster
around the outage windows identified in §3 — they are the latency signature of a degrading service,
which is one of the most useful things an on-call engineer can see. Treating them as corruption would
delete the early-warning signal. The mean is retained but demoted in the UI, because a handful of
3-second responses barely move it while p95/p99 show the degradation clearly.

---

### Negative findings — issues that were looked for and are **not** present

These were tested for explicitly. Reporting them as absent matters as much as reporting the real
issues, because inventing a problem is as misleading as missing one.

| Checked for | Result across all five files |
|---|---|
| Missing 15-minute intervals | **0** (after correct parsing — see I1) |
| Unexpected/off-grid intervals | **0** — every timestamp is 15-min aligned |
| Unparseable timestamps | **0** |
| Non-numeric status codes | **0** |
| Zero latency values | **0** |
| Missing `service_id` / `service_name` / `agent` / `region` | **0** |
| Unexpected service, agent or region names | **0** |
| `service_id` ↔ `service_name` mismatches | **0** |
| Ragged rows, blank lines, BOM, encoding corruption | **0** |
| Status codes in `3xx` or `4xx` | **0** — only `200`, `500`, `502`, `503`, `999` occur |

Gap detection and 4xx handling are still fully implemented, because an arbitrary uploaded CSV may
contain them. They simply report zero for these particular fixtures.

---

## 3. Status code distribution and failure patterns

Only five distinct status codes occur anywhere: `200`, `500`, `502`, `503`, `999`.

| Code | 9d | 12d | 14d | 21d | 30d |
|---|---:|---:|---:|---:|---:|
| `200` | 4,626 | 6,147 | 7,158 | 10,772 | 15,384 |
| `500` | 11 | 33 | 39 | 49 | 59 |
| `502` | 15 | 29 | 30 | 44 | 69 |
| `503` | 19 | 20 | 41 | 38 | 64 |
| `999` | 1 | 1 | 1 | 1 | 1 |

Failures are not uniformly distributed. Each dataset has a background error rate across all services
plus one or two dense clusters confined to a single service and a single day — the signature of an
outage rather than noise. `svc-reports` also carries a visibly elevated baseline error rate in every
dataset.

### Resulting availability

Computed per check-point, excluding invalid (`999`) observations, as defined in §5:

| Dataset | Valid check-points | Successful | **Availability** | vs 99.90% target |
|---|---:|---:|---:|---:|
| 9d_seed101 | 4,319 | 4,278 | **99.0507%** | −0.849 pp |
| 12d_seed505 | 5,759 | 5,682 | **98.6630%** | −1.237 pp |
| 14d_seed202 | 6,720 | 6,615 | **98.4375%** | −1.463 pp |
| 21d_seed303 | 10,079 | 9,955 | **98.7697%** | −1.130 pp |
| 30d_seed404 | 14,399 | 14,217 | **98.7360%** | −1.164 pp |

**All five datasets breach the 99.9% SLA target**, and every one would therefore trigger a billing
credit. None is anywhere near the target — the closest is 0.85 percentage points short. The 99.9%
figure is a contractual target the dashboard compares against; it is never displayed as an achieved
value.

---

## 4. `dataset_incident_log.json` — inspected, deliberately **not** used as a data source

### Schema

```jsonc
{
  "monitoring_checks_9d_seed101.csv": {          // ← keyed by CSV FILENAME
    "days": 9,
    "start": "2025-05-08",
    "incidents": {
      "svc-reports day 5": "check-points 64-69 (~16:00-17:15 UTC)"
    }
  }
}
```

1,104 bytes. Five top-level keys, one per supplied CSV. Each entry holds a day count, a start date,
and one or two injected outage windows expressed as a **service + day offset** with a
**check-point index range** in a human-readable string.

### What it is

It is a **generator answer key** — metadata describing how the fixtures were synthesised — not
operational incident data. The evidence:

- It is **keyed by filename**, so it can only ever describe these five specific files.
- Incidents are addressed by **day offset and check-point index**, coordinates that only mean
  anything relative to a file's own start date — not by absolute timestamps.
- It carries **no incident ID, severity, status, owner, root cause, acknowledgement or resolution
  time** — none of the fields a real incident record has.
- The window is a **prose string** (`"check-points 64-69 (~16:00-17:15 UTC)"`), not structured data.

### Why it is not wired into the application

Consuming it would require matching an uploaded file by name against a hardcoded table — making the
application dependent on filenames like `monitoring_checks_9d_seed101.csv`, so uploading the exact
same data as `health-checks.csv` would silently produce a different dashboard. It would also mean
displaying incidents the uploaded data does not itself support, which is precisely the fabricated
relationship the brief warns against. And since it only covers these five files, every real upload
would show nothing.

**So it is used as a validation oracle instead.** The application derives incidents purely from
persisted check data — consecutive failed check-points per service, merging gaps of up to 3
check-points, requiring at least 4 failures — a rule that works on any uploaded CSV. The test suite
then compares that derived output against the JSON the pipeline never reads:

| Dataset | Derived from CSV data alone | JSON answer key | |
|---|---|---|---|
| 12d | `svc-search` day 4, cp **48–67** | day 4, cp **48–67** | ✅ exact |
| 30d | `svc-reports` day 3, cp **47–55** | day 3, cp **47–55** | ✅ exact |
| 30d | `svc-auth` day 16, cp 16–40 | day 16, cp 16–41 | ✅ start exact |
| 21d | `svc-payments` day 2, cp 38–58 | day 2, cp 38–60 | ✅ start exact |
| 14d | `svc-notify` day 0, cp 59–76 | day 0, cp 59–77 | ✅ start exact |
| 14d | `svc-notify` day 6, cp 30–39 | day 6, cp 30–40 | ✅ start exact |
| 9d | `svc-reports` day 5, cp 64–72 | day 5, cp 64–69 | ✅ start exact |

Every injected outage is recovered at the correct service, correct day and correct starting
check-point, without the detector ever seeing the key. Trailing edges differ by 1–3 check-points
because the injected outages are intermittent — the service recovers briefly inside the window — so
the derived end lands on the last *observed* failure rather than the generator's nominal boundary.

**Two discrepancies, recorded rather than tuned away:**

- **Recall gap:** the 12d `svc-search day 8` window (cp 49–54) does not clear the ≥4-failure
  threshold and is not reported. Lowering the threshold to catch it would turn ordinary background
  errors into phantom incidents across every dataset.
- **False positive:** 14d yields an extra `svc-reports day 8` cluster (cp 29–36) that is absent from
  the key. `svc-reports` has the highest baseline error rate in every dataset, and this cluster is
  real in the data — the generator simply did not inject it.

The thresholds were chosen for sane general behaviour and deliberately **not** fitted to make these
two rows disappear; over-fitting a detector to an answer key it will never see in production would
be self-deception.

The JSON therefore ships in `fixtures/` and is read **only by the test suite**. It is never parsed by
the Worker, never stored in the database, and never displayed in the dashboard.

---

## 5. SLA calculation — the rule, stated exactly

**Unit.** One **check-point** = one `(service, interval)` pair. The interval is **inferred** from the
modal gap between consecutive checks per service (15 minutes in all supplied fixtures) and is never
hardcoded.

**Outcome of a check-point.** Where several agents observed the same check-point, the observations
collapse to one outcome, **worst observation winning**:

| Status code | Outcome |
|---|---|
| `[200, 400)` | **Success** |
| `[400, 600)` | **Failure** |
| Anything else (e.g. `999`), or unparseable | **Invalid** — excluded from the denominator, never a success |

```
availability = successful check-points / valid observed check-points × 100
```

**Why worst-wins:** a failure observed by any agent is positive evidence of failure, whereas one
agent's success does not disprove another agent's failure. It is also the reading that favours the
customer, which is the correct default when the output decides a billing credit. After `999`
exclusion there are zero remaining observer disagreements in these fixtures, so this choice changes
no number here — but it makes the rule unambiguous for arbitrary future data.

**Missing check-points are never treated as successful.** They are excluded from the denominator and
reported separately as coverage:

```
coverage = observed valid check-points / expected check-points × 100
```

Where coverage is below 100%, the dashboard labels availability an **upper bound**, because a check
that never ran cannot be evidence that the service was healthy. Both numbers are always shown
together, so a dataset cannot achieve a flattering availability figure by simply lacking data.

**The 99.90% target is a constant to compare against, never a computed value.** The dashboard
displays actual availability, the target, the difference in percentage points, the share of error
budget consumed, and the resulting credit-eligibility verdict.

---

## 6. Summary of handling decisions

| # | Issue | Severity | Decision | Data affected |
|---|---|---|---|---|
| I1 | Mixed timestamp encodings | CRITICAL | Normalize all three to UTC; convert offsets, never truncate | 102–342 rows/file |
| I2 | `agent-2` redundant observer | HIGH | Compute per check-point, not per row; persist both observations | 345–1,153 rows/file |
| I3 | Status `999` | HIGH | Invalid → excluded from denominator, never a success; kept and badged | 1 row/file |
| I4 | Latency unit varies by service | HIGH | Normalize to ms via `latency_unit`; keep original | 935–3,131 rows/file |
| I5 | Negative latency | MEDIUM | Null the latency, keep the row | 1 row/file |
| I6 | Three duplicate classes | MEDIUM | Remove (a), resolve (b) by completeness, preserve (c) | 7–25 removed/file |
| I7 | Missing latency | MEDIUM | Null, keep row, exclude from latency stats only | 56–186 rows/file |
| I8 | Latency tail spikes | LOW | Keep unclipped; report p50/p95/p99 over mean | ~5–10 rows/file |

**Rows are never silently discarded.** Any row that cannot be salvaged is written to the
`rejected_rows` table with its line number, its original text and a machine-readable reason, and the
counts are returned in the upload response and shown in the UI. Across all five supplied fixtures,
**zero rows are rejected** — every issue above is repaired rather than dropped, because in each case
the row still carries a valid availability observation.
