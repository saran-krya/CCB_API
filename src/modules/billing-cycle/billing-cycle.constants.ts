import { BillingCycleStatus } from './entities/billing-cycle.entity';
import { UpdateBillingCycleDto } from './dto/billing-cycle.dto';

// Kept as 'billing_cycles' (not 'BillingCycle') to match every audit row
// already written by the pre-existing implementation — changing it would
// split one module's audit trail across two module names.
export const BILLING_CYCLE_AUDIT_MODULE_NAME = 'billing_cycles';

export const BILLING_CYCLE_CHANGE_REASON_LOV_CATEGORY = 'BILLING_CYCLE_CHANGE_REASON';
export const BILLING_CYCLE_DEPRECATION_REASON_LOV_CATEGORY = 'BILLING_CYCLE_DEPRECATION_REASON';

export enum BillingCycleAuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  RESUBMIT = 'RESUBMIT',
  CREATE_VERSION = 'CREATE_VERSION',
  // The decision to deprecate was recorded with a future effective date —
  // status has NOT changed yet. Distinct from DEPRECATE (status actually
  // flipped) so the audit trail can tell "scheduled" apart from "applied".
  SCHEDULE_DEPRECATION = 'SCHEDULE_DEPRECATION',
  DEPRECATE = 'DEPRECATE',
  AUTO_ACTIVATE = 'AUTO_ACTIVATE',
  AUTO_DEPRECATE = 'AUTO_DEPRECATE',
}

export const BILLING_CYCLE_CODE_PREFIX = 'ILCY-';
export const BILLING_CYCLE_CODE_PAD_WIDTH = 6;

// Module Attribute keys — pre-fill the create-form's day offsets. These are
// defaults only (per-cycle values remain freely overridable), the same
// convention as Tariff's TARIFF_DEFAULT_VAT_RATE.
export const DEFAULT_BILL_GENERATION_DAYS_ATTRIBUTE_KEY = 'BILLING_CYCLE_DEFAULT_BILL_GENERATION_DAYS';
export const DEFAULT_BILL_ISSUE_DAYS_ATTRIBUTE_KEY = 'BILLING_CYCLE_DEFAULT_BILL_ISSUE_DAYS';
export const DEFAULT_BILL_DUE_DAYS_ATTRIBUTE_KEY = 'BILLING_CYCLE_DEFAULT_BILL_DUE_DAYS';
export const REQUIRE_CHANGE_REASON_ON_EDIT_ATTRIBUTE_KEY = 'REQUIRE_CHANGE_REASON_ON_EDIT';

// A cycle can still be edited (frequency, day offsets, status) in any of
// these statuses. DEPRECATED is permanently read-only, and PENDING is
// read-only while it awaits Finance's decision — approve()/reject() are the
// only actions that may touch a pending version. Reading dates are excluded
// from this entirely: see LOCKED_BILLING_CYCLE_FIELDS below, which apply
// regardless of status.
export const EDITABLE_BILLING_CYCLE_STATUSES = new Set([
  BillingCycleStatus.INACTIVE,
  BillingCycleStatus.ACTIVE,
  BillingCycleStatus.REJECTED,
]);

// Business Rule 1: the reading window can never be changed on an existing
// billing cycle "under any circumstance" — the only way to change it is the
// new-version flow (newVersion()), never a plain update(). Unlike Tariff's
// ACTIVE_LOCKED_TARIFF_FIELDS (locked only while ACTIVE), this lock applies
// unconditionally, in every status.
export const LOCKED_BILLING_CYCLE_FIELDS: (keyof UpdateBillingCycleDto)[] = ['readingStartDay', 'readingEndDay'];

// Business Rule 3/5: a new version can only be branched from the property's
// current governing configuration — not from an already-pending, rejected,
// or deprecated one.
export const NEW_VERSION_SOURCE_STATUSES = new Set([BillingCycleStatus.ACTIVE, BillingCycleStatus.INACTIVE]);
