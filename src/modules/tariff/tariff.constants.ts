import { TariffStatus } from './entities/tariff-version.entity';
import { UpdateTariffDto } from './dto/tariff.dto';

export const TARIFF_AUDIT_MODULE_NAME = 'Tariff';

// A single missing/invalid field found by TariffService.getValidationIssues().
// `field` matches the frontend form's own field/state name exactly, so the
// UI can highlight the right input directly off this list without a lookup
// table on either side. `step` is stamped from TARIFF_FIELD_METADATA (see
// tariff-field-metadata.ts) — the same registry that drives DTO validation
// and the frontend's `*`/min/max, so a field's step lives in exactly one
// place instead of its own separate lookup table.
export interface TariffValidationIssue {
  field: string;
  message: string;
  step: number;
}

// Lookup Field Master category backing the "Unit type" dropdown — values are
// managed dynamically via Admin > System Admin > Lookup Field Master instead
// of being a hardcoded enum. Seeded with 'residential'/'commercial'.
export const TARIFF_UNIT_TYPE_LOV_CATEGORY = 'TARIFF_UNIT_TYPE';

// Lookup Field Master category backing the Reject dialog's reason dropdown —
// same reasoning as TARIFF_UNIT_TYPE_LOV_CATEGORY above (see
// TariffService.assertValidRejectionReason).
export const TARIFF_REJECTION_REASON_LOV_CATEGORY = 'TARIFF_REJECTION_REASON';

// The two seed codes above, kept as constants only for the fixed
// residential/commercial columns in getStats()'s applicability breakdown —
// not a validation allowlist. Any code active in the LOV category is a
// valid unit type.
export const TARIFF_UNIT_TYPE_RESIDENTIAL = 'residential';
export const TARIFF_UNIT_TYPE_COMMERCIAL = 'commercial';

export enum TariffAuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  SUBMIT = 'SUBMIT',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  DEACTIVATE = 'DEACTIVATE',
  REACTIVATE = 'REACTIVATE',
  DEPRECATE = 'DEPRECATE',
  CREATE_VERSION = 'CREATE_VERSION',
  AUTO_DEPRECATE = 'AUTO_DEPRECATE',
  AUTO_EXPIRE = 'AUTO_EXPIRE',
}

// Falls back to this only if the TARIFF_DEFAULT_VAT_RATE attribute is
// missing entirely — mirrors the entity/DTO column default below.
export const DEFAULT_VAT_RATE_FALLBACK = 5;

export const SORTABLE_TARIFF_FIELDS = new Set([
  'name',
  'businessCode',
  'status',
  'propertyType',
  'rateType',
  'applicability',
  'effectiveFrom',
  'createdAt',
]);

export const TARIFF_SORT_COLUMN_MAP: Record<string, string> = {
  businessCode: 'master.businessCode',
  name: 'version.name',
  status: 'version.status',
  propertyType: 'version.propertyType',
  rateType: 'version.rateType',
  applicability: 'version.applicability',
  effectiveFrom: 'version.effectiveFrom',
  createdAt: 'version.createdAt',
};

// Statuses a tariff can still be edited from at all. ACTIVE is included but
// narrowed by ACTIVE_LOCKED_FIELDS below — DEPRECATED/EXPIRED are read-only
// forever (PDF: "read only — no edits possible"), and PENDING is locked
// unconditionally while Finance review is in progress — not even the
// submitter can edit it; Finance must Approve or Reject first.
export const EDITABLE_TARIFF_STATUSES = new Set([
  TariffStatus.DRAFT,
  TariffStatus.REQUEST_FOR_CORRECTION,
  TariffStatus.REJECTED,
  TariffStatus.INACTIVE,
  TariffStatus.ACTIVE,
]);

// PENDING is deliberately NOT included: it's fully locked from editing (see
// EDITABLE_TARIFF_STATUSES) while Finance review is in progress, so there is
// no "resubmit an already-pending tariff" case to support — Finance must
// approve or reject it first. Only a tariff that has never been reviewed
// (Draft) or was already reviewed and sent back (Request for Correction,
// Rejected) can be (re)submitted.
export const SUBMITTABLE_TARIFF_STATUSES = new Set([
  TariffStatus.DRAFT,
  TariffStatus.REQUEST_FOR_CORRECTION,
  TariffStatus.REJECTED,
]);

// PDF "New Version vs Editing Existing Version" table: these fields change
// the core billing amount/scope, so on an ACTIVE tariff they're blocked
// entirely — the caller must go through newVersion() instead. Everything
// else in UpdateTariffDto (fees, penalties, name/description, VAT reg
// number, effectiveTo, ...) is "edit in place allowed" per that same table.
//
// This is the FALLBACK only. The real source of truth is the
// TARIFF_ACTIVE_LOCKED_FIELDS module attribute (Attributes > Tariff Config >
// "Fields Locked for Active Tariffs") — see
// TariffService.getActiveLockedFields(). This array is seeded as that
// attribute's initial value and is used only if the attribute is ever
// missing or empty.
//
// TEMPORARY SCOPE (pending Billing Engine): per the PDF spec, this
// field-lock behavior is only supposed to govern Scenario 3 — an Active
// tariff that has NOT yet generated any invoices. Scenario 4 (Active +
// invoices already exist) is supposed to make the ENTIRE tariff read-only,
// with no field-level distinction — the only allowed action is Create New
// Version. Today there is no invoice-usage tracking to tell Scenario 3
// apart from Scenario 4, so every Active tariff is treated as Scenario 3
// (this list applies universally). See the TODO on
// TariffService.assertActiveEditAllowed().
export const ACTIVE_LOCKED_TARIFF_FIELDS: (keyof UpdateTariffDto)[] = [
  'propertyType',
  'rateType',
  'flatRate',
  'tiers',
  'applicability',
  'propertyIds',
  'unitIds',
  'billingServiceFee',
  'vat',
  'effectiveFrom',
];

// Closed set of field names TARIFF_ACTIVE_LOCKED_FIELDS is allowed to
// contain — the same fields listed in ACTIVE_LOCKED_TARIFF_FIELDS above,
// since that array already enumerates every field it structurally makes
// sense to lock (core billing amount/scope fields per the PDF's "New
// Version vs Editing Existing Version" table). Used to validate the
// attribute's value on write (AttributeService.update()) and defensively on
// read (TariffService.getActiveLockedFields()) — a typo or an invalid field
// name must never silently pass through either boundary. Kept in its own
// exported Set (not just re-derived inline) so both call sites check the
// exact same allowlist.
export const LOCKABLE_TARIFF_FIELDS = new Set<string>(ACTIVE_LOCKED_TARIFF_FIELDS);

// Human-readable labels for the checkbox list in Module Attributes >
// Tariff Config > "Fields Locked for Active Tariffs" — keyed by the same
// field names as LOCKABLE_TARIFF_FIELDS so the two can never drift apart
// (every lockable field has exactly one label, every label corresponds to
// exactly one lockable field).
export const LOCKABLE_TARIFF_FIELD_LABELS: Record<string, string> = {
  propertyType: 'Unit Type',
  rateType: 'Rate Type',
  flatRate: 'Flat Rate',
  tiers: 'Consumption Tiers',
  applicability: 'Applicability',
  propertyIds: 'Applicable Properties',
  unitIds: 'Applicable Units',
  billingServiceFee: 'Billing Service Fee',
  vat: 'VAT Rate',
  effectiveFrom: 'Effective From',
};
