import { FieldMetadataMap } from '../../common/interfaces/field-metadata.interface';

// Sanity ceilings, not spec-derived business limits — the functional spec
// gives no numeric bounds for any fee or rate, so these exist purely to
// catch data-entry mistakes (an extra zero, a misplaced decimal) rather than
// to encode a real pricing policy. Grouped by how the fee recurs, since
// that's what makes one figure sane for one bucket and absurd for another: a
// one-time fee in the tens of thousands is plausible, a *monthly* one almost
// never is. Lives here (not in tariff.dto.ts) so both the DTO decorators AND
// TARIFF_FIELD_METADATA below can import them without a circular dependency
// between the two files.
export const ONE_TIME_FEE_MAX = 50_000;
export const RECURRING_FEE_MAX = 5_000;
export const PENALTY_FEE_MAX = 10_000;
// Real UAE utility rates run a small fraction of 1 AED/kWh — this ceiling
// exists purely to catch a misplaced decimal (e.g. "500" typed for "0.500").
export const RATE_MAX = 100;

// Single source of truth for every Tariff wizard field's business rules —
// consumed by tariff.dto.ts's class-validator decorators (so the enforced
// number and the documented number can never drift, since both read the
// same exported consts above) and served to the frontend via
// TariffService.getFilterMetadata() as `fieldMetadata`, so the wizard's `*`
// indicators, HTML5 min/max attributes and step-completion checks read the
// same rules the backend actually enforces instead of a hand-duplicated copy.
//
// Deliberately does NOT encode conditional rules (a field required only
// because a sibling field has a certain value, or a max that depends on a
// sibling field) — those can't survive being serialized to the frontend as
// plain data anyway, so they stay as explicit, cross-referenced code on both
// sides:
//   - flatRate/tiers required only for their own rateType: CreateTariffDto's
//     @ValidateIf + TariffService.getValidationIssues (backend),
//     isStep2Complete (frontend).
//   - propertyIds/unitIds required only for their own applicability: same
//     pattern, same two places.
//   - vatRegistrationNumber required only when vat > 0:
//     TariffService.getValidationIssues (backend), isStep3Complete +
//     isTrnProvidedIfVatCharged (frontend).
//   - latePaymentPenalty's max is 100 in percentage mode, not PENALTY_FEE_MAX:
//     common/validators/amount-or-percentage.validator.ts (backend),
//     isStep3Complete's ternary (frontend). The entry below documents the
//     flat-mode (default) ceiling only.
//   - meterRentalFee must be > 0 while meterRentalEnabled is true, not just
//     >= 0: common/validators/is-positive-when-enabled.validator.ts
//     (backend), isStep3Complete's extra clause (frontend). The entry below
//     documents the base (disabled) case, where 0 is fine.
// `required: true` here means "mandatory once the field applies at all" —
// for the conditionally-applicable fields above, the surrounding
// @ValidateIf/conditional-render already supplies the "when", this only
// answers "and is it mandatory when shown".
export const TARIFF_FIELD_METADATA: FieldMetadataMap = {
  // Step 1 — Tariff & Applicability
  name: { step: 1, label: 'Tariff Name', required: true, maxLength: 160, format: 'text' },
  propertyType: { step: 1, label: 'Unit Type', required: true, format: 'text' },
  rateType: { step: 1, label: 'Rate Type', required: true, format: 'text' },
  applicability: { step: 1, label: 'Applicability', required: true, format: 'text' },
  propertyIds: { step: 1, label: 'Properties', required: true, format: 'count' },
  unitIds: { step: 1, label: 'Units', required: true, format: 'count' },
  effectiveFrom: { step: 1, label: 'Effective From', required: true, format: 'date' },
  effectiveTo: { step: 1, label: 'Effective To', required: false, format: 'date' },
  description: { step: 1, label: 'Description', required: false, maxLength: 1000, format: 'text' },

  // Step 2 — Consumer Energy Rates. allowZero: false throughout — a $0/kWh
  // rate isn't a discount, it's a data-entry mistake.
  flatRate: { step: 2, label: 'Rate per kWh', required: true, allowZero: false, min: 0.0001, max: RATE_MAX, format: 'currency' },
  tiers: { step: 2, label: 'Consumption Tiers', required: true, format: 'count' },
  ratePerKwh: { step: 2, label: 'Tier Rate per kWh', required: true, allowZero: false, min: 0.0001, max: RATE_MAX, format: 'currency' },
  minKwh: { step: 2, label: 'Tier Min kWh', required: true, allowZero: true, min: 0, format: 'count' },
  maxKwh: { step: 2, label: 'Tier Max kWh', required: false, allowZero: true, min: 0, format: 'count' },

  // Step 3 — Fees & Penalties. allowZero: true throughout — waiving a
  // one-time charge or not enforcing a penalty is a legitimate business
  // choice, unlike the core rate above.
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
