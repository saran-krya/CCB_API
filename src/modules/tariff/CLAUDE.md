# Tariff Module — Future Implementation Note

## Active-Tariff Edit Scope — resolved: Active is fully read-only

**Current behavior**

An `active` (approved) tariff cannot be edited in place at all, regardless of whether any
invoices/billing usage exist against it. `ACTIVE` is not in `EDITABLE_TARIFF_STATUSES`
(`tariff.constants.ts`) — `TariffService.update()` rejects any attempt to edit it before ever
inspecting individual fields. The only actions available on an active tariff are Deprecate
(`deprecate()`) and Create New Version (`newVersion()`), matching the frontend's
`getTariffActions()` gating.

This deliberately supersedes an earlier interim design ("Scenario 3 vs Scenario 4") that allowed
partial in-place editing of an active tariff via a configurable locked-fields list
(`TARIFF_ACTIVE_LOCKED_FIELDS`, still present as a System Admin attribute and still returned by
`getFilterMetadata()`/consulted by `TariffCreateForm.tsx`'s `isFieldLocked`, but now unreachable in
practice since the edit form's own read-only guard — `!existingTariff.isEditable` — already blocks
entry to the edit screen for any active tariff before that per-field logic would ever run). That
attribute and the frontend code reading it were intentionally left in place rather than removed, to
avoid a larger unrelated cleanup; they are inert, not broken.

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
