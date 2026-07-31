import { FieldMetadataMap } from '../../common/interfaces/field-metadata.interface';

export const ONE_TIME_FEE_MAX = 50_000;
export const RECURRING_FEE_MAX = 5_000;
export const PENALTY_FEE_MAX = 10_000;
export const RATE_MAX = 100;

export const TARIFF_FIELD_METADATA: FieldMetadataMap = {
  name: { step: 1, label: 'Tariff Name', required: true, maxLength: 160, format: 'text' },
  propertyType: { step: 1, label: 'Unit Type', required: true, format: 'text' },
  rateType: { step: 1, label: 'Rate Type', required: true, format: 'text' },
  applicability: { step: 1, label: 'Applicability', required: true, format: 'text' },
  propertyIds: { step: 1, label: 'Properties', required: true, format: 'count' },
  unitIds: { step: 1, label: 'Units', required: true, format: 'count' },
  effectiveFrom: { step: 1, label: 'Effective From', required: true, format: 'date' },
  effectiveTo: { step: 1, label: 'Effective To', required: false, format: 'date' },
  description: { step: 1, label: 'Description', required: false, maxLength: 1000, format: 'text' },

  flatRate: { step: 2, label: 'Rate per kWh', required: true, allowZero: false, min: 0.0001, max: RATE_MAX, format: 'currency' },
  tiers: { step: 2, label: 'Consumption Tiers', required: true, format: 'count' },
  ratePerKwh: { step: 2, label: 'Tier Rate per kWh', required: true, allowZero: false, min: 0.0001, max: RATE_MAX, format: 'currency' },
  minKwh: { step: 2, label: 'Tier Min kWh', required: true, allowZero: true, min: 0, format: 'count' },
  maxKwh: { step: 2, label: 'Tier Max kWh', required: false, allowZero: true, min: 0, format: 'count' },

  billingServiceFee: { step: 3, label: 'Billing Service Fee', required: false, allowZero: true, min: 0, max: RECURRING_FEE_MAX, format: 'currency' },
  activationFee: { step: 3, label: 'Activation Fee', required: false, allowZero: true, min: 0, max: ONE_TIME_FEE_MAX, format: 'currency' },
  securityDeposit: { step: 3, label: 'Security Deposit', required: false, allowZero: true, min: 0, max: ONE_TIME_FEE_MAX, format: 'currency' },
  nocFee: { step: 3, label: 'NOC Fee', required: false, allowZero: true, min: 0, max: ONE_TIME_FEE_MAX, format: 'currency' },
  moveOutFee: { step: 3, label: 'Move-Out Fee', required: false, allowZero: true, min: 0, max: ONE_TIME_FEE_MAX, format: 'currency' },
  meterVerificationFee: { step: 3, label: 'Meter Verification Fee', required: false, allowZero: true, min: 0, max: ONE_TIME_FEE_MAX, format: 'currency' },
  latePaymentPenaltyType: { step: 3, label: 'Late Payment Penalty Type', required: false, format: 'text' },
  latePaymentPenalty: { step: 3, label: 'Late Payment Penalty', required: false, allowZero: true, min: 0, max: PENALTY_FEE_MAX, format: 'currency' },
  disconnectionFee: { step: 3, label: 'Disconnection Fee', required: false, allowZero: true, min: 0, max: PENALTY_FEE_MAX, format: 'currency' },
  reconnectionFee: { step: 3, label: 'Reconnection Fee', required: false, allowZero: true, min: 0, max: PENALTY_FEE_MAX, format: 'currency' },
  tamperingPenalty: { step: 3, label: 'Meter Tampering Penalty', required: false, allowZero: true, min: 0, max: PENALTY_FEE_MAX, format: 'currency' },
  bouncedChequeFee: { step: 3, label: 'Bounced Cheque Fee', required: false, allowZero: true, min: 0, max: PENALTY_FEE_MAX, format: 'currency' },
  meterRentalEnabled: { step: 3, label: 'Meter Rental Enabled', required: false, format: 'boolean' },
  meterRentalFee: { step: 3, label: 'Meter Rental Fee', required: false, allowZero: true, min: 0, max: RECURRING_FEE_MAX, format: 'currency' },
  vat: { step: 3, label: 'VAT Rate', required: false, allowZero: true, min: 0, max: 100, format: 'percentage' },
  vatRegistrationNumber: { step: 3, label: 'VAT Registration Number', required: false, minLength: 15, maxLength: 15, format: 'text' },
};
