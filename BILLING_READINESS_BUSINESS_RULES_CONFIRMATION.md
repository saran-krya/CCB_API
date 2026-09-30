# Billing Readiness — Business Rule Confirmation Checklist

Purpose: lock down the business rules Phase 1 (CCB_API) needs before any code is written.
None of the values below are inherited from CCB_Template — that project is a UI/UX mock only, and
its numbers/logic are never treated as real business policy. Where a Template value is mentioned,
it is mentioned only to explicitly reject it, not as a default.

Status of each item: **CONFIRMED** or **DEFERRED** (deferred = explicitly out of scope for this
phase, not an open question). All items below are now settled — none remain PENDING.

---

## 1. Ready / On Hold / Not Ready — exact conditions

**Decision:** Strict precedence, evaluated in this order — **NOT READY → ON HOLD → READY**. A
property is downgraded by the first rule it fails; it never needs to fail every rule to end up
Not Ready.

- **NOT READY** if any of the following is true:
  - Billing cycle not closed, or no billing cycle configured at all.
  - Any billable unit is missing a resolvable tariff.
  - Any billable unit is missing a mapped meter.
  - Any billable unit is missing an expected reading within the cycle window.
  - Any unresolved **CRITICAL** or **HIGH** severity anomaly exists.
- **ON HOLD** if none of the NOT READY conditions apply, but at least one unresolved **MEDIUM** or
  **LOW** severity anomaly remains.
- **READY** if the cycle is closed, all mandatory checks pass, all expected readings for
  billable/mapped units are approved, and there are no blocking (unresolved MEDIUM/LOW or worse)
  anomalies remaining.

**Status:** CONFIRMED

---

## 2. Reading approval percentage rule

**Decision:** No percentage threshold. Require **100%** of expected readings for
billable/mapped units to be approved. The Template's 80% reference value is explicitly rejected.

**Status:** CONFIRMED

---

## 3. Open anomaly impact

**Decision:**
- Unresolved **CRITICAL or HIGH** severity → **NOT READY**.
- Unresolved **MEDIUM or LOW** severity → **ON HOLD** (does not force Not Ready on its own).
- A resolved or approved anomaly/reading does not block readiness at any severity.

**Status:** CONFIRMED

---

## 4. Tariff missing → what status?

**Decision:** Every billable unit must have a resolvable tariff (via the existing
`TariffService.resolveForUnit` resolution precedence). A missing tariff on **any** billable unit
→ **NOT READY for the whole property** (not just a per-unit flag).

**Status:** CONFIRMED

---

## 5. Meter / Reading — mapping and reading requirements

**Decision:** Every billable unit must have BOTH a mapped meter AND a reading recorded within the
billing-cycle window. Missing either → **NOT READY**. No tolerance in Phase 1 (i.e., no "N
unmapped units is still acceptable" allowance) — this may be revisited in a later phase if real
operational data shows it's too strict.

**Status:** CONFIRMED

---

## 6. Occupancy source of truth

**Decision:** The authoritative signal is the real **active `Customer.unit` relationship**
(i.e., does an ACTIVE Customer row exist for this unit) — **not** `Unit.occupancyStatus`, which
stays unused for readiness purposes since it's only ever set manually and can drift from reality.

Occupancy itself is **informational only** and **must NOT block billing readiness** — a vacant
unit is still billed (to the owner) and does not by itself force Not Ready or On Hold.

**Status:** CONFIRMED

---

## 7. Billing Cycle dependency

**Decision:** A valid billing cycle must exist for the property, and it must be **closed** before
the property can reach READY. No configured cycle at all → **NOT READY** (the property still
appears in the readiness report, it is not hidden/excluded — see date-scope note in item 12 for
how "closed" is determined operationally).

**Status:** CONFIRMED

---

## 8. Estimated bill calculation

**Decision:** **Not implemented in Phase 1.** No estimated-bill-amount figure is calculated,
displayed, or stubbed with a placeholder anywhere in the Phase 1 UI/API. Any dashboard element
that would have shown this in the Template is simply omitted, not mocked.

**Status:** CONFIRMED

---

## 9. Bill Run + Finance + Invoice

**Decision:** **DEFERRED** to a future phase in full. Phase 1 is Billing Readiness (triage/report)
only — no Bill Run entity, no Finance approval workflow, no Invoice generation, no related
endpoints or UI, in this phase.

**Status:** DEFERRED

---

## 10. Field Inspection

**Decision:** **DEFERRED** to a future phase in full. No Field Inspection request/tracking
entity, endpoint, or UI in Phase 1. Explicitly: no fake/local-only persistence (e.g. a
client-side-only React state Map) is to be built as a placeholder for this — if it isn't real and
persisted, it isn't built at all in Phase 1.

**Status:** DEFERRED

---

## 11. Readiness calculation — compute live vs. cache

**Decision:** Compute readiness **live** on every request in Phase 1. No caching or materialized
readiness view is introduced unless a real, observed performance problem justifies it later — this
is not to be pre-optimized speculatively.

**Status:** CONFIRMED

---

## 12. Date scope

**Decision:** Billing Readiness evaluates the **billing-cycle date range**
(`readingStartDate` → `readingEndDate` for the property's active cycle), not a single calendar
date. Existing date-scoped aggregates (`getPropertyReadingSummary`, `getAnomaliesByCommunity`,
etc.) need a range-scoped variant/parameter for this feature rather than a new aggregate table.

**Status:** CONFIRMED

---

## Outcome

All 12 items are settled (10 CONFIRMED, 2 explicitly DEFERRED — items 9 and 10). Phase 1 backend
work may proceed strictly within these decisions. Nothing here should be reopened or reinterpreted
during implementation — if an edge case arises that these rules don't clearly cover, it should be
raised as a new question rather than resolved by guessing.
