# Tariff Module — Future Implementation Note

## Active-Tariff Edit Scope — Scenario 3 vs Scenario 4 (Pending Dependency)

**Business Rule (Pending Dependency)**

As per the Tariff functional specification, an Active tariff has two distinct edit scopes:

> - **Scenario 3** — Active tariff, no invoices generated yet: a bounded set of fields is locked
>   (see `TARIFF_ACTIVE_LOCKED_FIELDS`); everything else can still be edited in place.
> - **Scenario 4** — Active tariff, one or more invoices already generated: the entire tariff must
>   become read-only. No field may be edited in place, regardless of the locked-fields list. The
>   only allowed action is Create New Version.

**Current Status**

- Implemented (`TariffService.update()`, `assertActiveEditAllowed()`, `getActiveLockedFields()`):
  - Scenario 3's partial field lock, driven by the `TARIFF_ACTIVE_LOCKED_FIELDS` module attribute
    (Attributes > Tariff Config > "Fields Locked for Active Tariffs").
  - Non-locked-field edits to an Active tariff bump a minor version and resubmit for Finance
    approval.
- Pending:
  - Detecting whether a tariff has any invoices generated against it (Scenario 4).
  - Rejecting ALL edits outright once a tariff is in Scenario 4, instead of consulting
    `TARIFF_ACTIVE_LOCKED_FIELDS` at all.

**Reason**

The current project does not yet include the Billing Engine / Invoice Generation module, so there
is no reliable way to determine whether a tariff has been used to generate one or more invoices.
As a result, `TariffService` currently treats **every** Active tariff as Scenario 3 — the
`TARIFF_ACTIVE_LOCKED_FIELDS` partial lock applies universally, even to tariffs that (once invoice
tracking exists) would actually be in Scenario 4 and should be fully read-only. This is a
deliberate, accepted interim behavior, not an oversight — see the TODO comments on
`TariffService.assertActiveEditAllowed()` and `getActiveLockedFields()`.

**Future Implementation**

When the Billing Engine is implemented:

- Before consulting `TARIFF_ACTIVE_LOCKED_FIELDS`, check whether the tariff has one or more
  invoices generated against it.
- If yes (Scenario 4), reject the entire update unconditionally — do not fall through to the
  field-lock check. Only Create New Version (`newVersion()`) remains available.
- If no (true Scenario 3), keep today's behavior: consult `TARIFF_ACTIVE_LOCKED_FIELDS` and allow
  editing every field not on that list.

## Manual Deprecation — Active Billing Usage Check (Pending Dependency)

**Business Rule (Pending Dependency)**

As per the Tariff functional specification:

> Manual deprecation must be blocked if the tariff is currently being used by an active billing process.

**Current Status**

- Implemented (`TariffService.deprecate()`, `TariffController`'s `PATCH :id/deprecate`):
  - Super Admin authorization.
  - Confirmation before deprecation.
  - Immediate deprecation (today).
- Pending:
  - Dependency check to prevent deprecating a tariff that is actively in use.

**Reason**

The current project does not yet include the Billing Engine / Invoice Generation module, so there
is no reliable way to determine whether a tariff is actively being used for billing.

**Future Implementation**

When the Billing Engine is implemented:

- Before manual deprecation, check whether the tariff is referenced by any active billing process
  or billing run.
- If yes, block the deprecation and display an appropriate business validation message.
- If no, allow the normal manual deprecation flow.
