import { TariffStatus } from './entities/tariff.entity';
import { UpdateTariffDto } from './dto/tariff.dto';

export const TARIFF_AUDIT_MODULE_NAME = 'Tariff';

// Lookup Field Master category backing the "Unit type" dropdown — values are
// managed dynamically via Admin > System Admin > Lookup Field Master instead
// of being a hardcoded enum. Seeded with 'residential'/'commercial'.
export const TARIFF_UNIT_TYPE_LOV_CATEGORY = 'TARIFF_UNIT_TYPE';

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

// TAR-000123 — business code shown to users; shared across every version of
// the same tariff (see Tariff.businessCode).
export const TARIFF_CODE_PREFIX = 'TAR-';
export const TARIFF_CODE_PAD_WIDTH = 6;

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
  businessCode: 'tariff.businessCode',
  name: 'tariff.name',
  status: 'tariff.status',
  propertyType: 'tariff.propertyType',
  rateType: 'tariff.rateType',
  applicability: 'tariff.applicability',
  effectiveFrom: 'tariff.effectiveFrom',
  createdAt: 'tariff.createdAt',
};

// Statuses a tariff can still be edited from at all. ACTIVE is included but
// narrowed by ACTIVE_LOCKED_FIELDS below — DEPRECATED/EXPIRED are the only
// truly read-only-forever states (PDF: "read only — no edits possible").
export const EDITABLE_TARIFF_STATUSES = new Set([
  TariffStatus.DRAFT,
  TariffStatus.PENDING,
  TariffStatus.REQUEST_FOR_CORRECTION,
  TariffStatus.REJECTED,
  TariffStatus.INACTIVE,
  TariffStatus.ACTIVE,
]);

// PENDING is included so "Resubmit for Approval" works on an already-pending
// tariff — editing one no longer withdraws it from the queue (see
// TariffService.update()), so resubmitting just re-stamps submittedOn/By
// with the latest saved data instead of representing an actual status change.
export const SUBMITTABLE_TARIFF_STATUSES = new Set([
  TariffStatus.DRAFT,
  TariffStatus.PENDING,
  TariffStatus.REQUEST_FOR_CORRECTION,
  TariffStatus.REJECTED,
]);

// PDF "New Version vs Editing Existing Version" table: these fields change
// the core billing amount/scope, so on an ACTIVE tariff they're blocked
// entirely — the caller must go through newVersion() instead. Everything
// else in UpdateTariffDto (fees, penalties, name/description, VAT reg
// number, effectiveTo, ...) is "edit in place allowed" per that same table.
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
