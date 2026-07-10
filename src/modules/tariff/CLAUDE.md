# Tariff Module — Future Implementation Note

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
