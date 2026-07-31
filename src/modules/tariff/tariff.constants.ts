import { TariffStatus } from './entities/tariff-version.entity';
import { UpdateTariffDto } from './dto/tariff.dto';

export const TARIFF_AUDIT_MODULE_NAME = 'Tariff';

export interface TariffValidationIssue {
  field: string;
  message: string;
  step: number;
}

export const TARIFF_UNIT_TYPE_LOV_CATEGORY = 'TARIFF_UNIT_TYPE';

export const TARIFF_REJECTION_REASON_LOV_CATEGORY = 'TARIFF_REJECTION_REASON';

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

export const EDITABLE_TARIFF_STATUSES = new Set([
  TariffStatus.DRAFT,
  TariffStatus.REQUEST_FOR_CORRECTION,
  TariffStatus.REJECTED,
  TariffStatus.INACTIVE,
  TariffStatus.ACTIVE,
]);

export const SUBMITTABLE_TARIFF_STATUSES = new Set([
  TariffStatus.DRAFT,
  TariffStatus.REQUEST_FOR_CORRECTION,
  TariffStatus.REJECTED,
]);

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

export const LOCKABLE_TARIFF_FIELDS = new Set<string>(ACTIVE_LOCKED_TARIFF_FIELDS);

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
