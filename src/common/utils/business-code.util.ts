export const BUSINESS_CODE_PREFIXES = {
  COMMUNITY: 'COM',
  PROPERTY: 'PRP',
  UNIT: 'UNT',
  BILLING_CYCLE: 'ILCY',
  BILLING_RUN: 'BLR',
  INVOICE: 'INV',
  TARIFF: 'TAR',
  MASTER_METER: 'MMT',
  SUB_METER: 'SMT',
} as const;

export function generateBusinessCode(prefix: string, id: number): string {
  return `${prefix}-${String(id).padStart(6, '0')}`;
}
