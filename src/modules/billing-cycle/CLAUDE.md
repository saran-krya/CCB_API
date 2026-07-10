# Billing Cycle Module — Future Implementation Note

## Manual Deprecation — Active Billing Usage Check (Pending Dependency)

**Business Rule (Pending Dependency)**

Same principle as the Tariff module's functional specification, applied here by extension:

> Manual deprecation must be blocked if the billing cycle is currently being used by an active
> billing process.

**Current Status**

- Implemented (`BillingCycleService.deprecate()`, `BillingCycleController`'s `PATCH :id/deprecate`):
  - Super Admin authorization.
  - Confirmation before deprecation.
  - Immediate deprecation (today) and scheduled deprecation (future
    `effectiveDeprecationDate`, applied later by `BillingCycleSchedulerService`).
- Pending:
  - Dependency check to prevent deprecating a billing cycle that is actively in use.

**Reason**

The current project does not yet include the Billing Engine / Invoice Generation module, so there
is no reliable way to determine whether a billing cycle is actively being used for billing.

**Future Implementation**

When the Billing Engine is implemented:

- Before manual deprecation (immediate or scheduled), check whether the billing cycle is
  referenced by any active billing process or billing run.
- If yes, block the deprecation and display an appropriate business validation message.
- If no, allow the normal manual deprecation flow.
