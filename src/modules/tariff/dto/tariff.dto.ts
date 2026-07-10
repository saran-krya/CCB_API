import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { IsAmountOrPercentage } from '../../../common/validators/amount-or-percentage.validator';
import { IsPositiveWhenEnabled } from '../../../common/validators/is-positive-when-enabled.validator';
import {
  TariffApplicability,
  TariffPenaltyType,
  TariffRateType,
  TariffStatus,
} from '../entities/tariff-version.entity';
// The numeric ceilings below are defined in tariff-field-metadata.ts (not
// here) so that file's TARIFF_FIELD_METADATA and these decorators can both
// reference the same constants without a circular import between the two
// files — see that file's own comment for the full reasoning.
import {
  ONE_TIME_FEE_MAX,
  PENALTY_FEE_MAX,
  RATE_MAX,
  RECURRING_FEE_MAX,
} from '../tariff-field-metadata';

export enum VatApplicableFeeKey {
  ACTIVATION_FEE = 'activationFee',
  MOVE_OUT_FEE = 'moveOutFee',
  NOC_FEE = 'nocFee',
  METER_VERIFICATION_FEE = 'meterVerificationFee',
  BILLING_SERVICE_FEE = 'billingServiceFee',
  METER_RENTAL_FEE = 'meterRentalFee',
}

export class TariffTierDto {
  // 0 is a legitimate starting point (the first slab covers 0 kWh upward).
  @IsNumber()
  @Min(0)
  minKwh!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxKwh?: number | null;

  // Min(0.0001), not Min(0) — a tier billing AED 0/kWh isn't a discount,
  // it's a data-entry mistake (rate_per_kwh is decimal(10,4), so this is
  // the smallest representable value greater than zero at that precision).
  @IsNumber()
  @Min(0.0001)
  @Max(RATE_MAX)
  ratePerKwh!: number;
}

export class CreateTariffDto {
  // Unlike rate/scope (deferrable to later wizard steps — see
  // TariffService.getValidationIssues), name is a Step 1 field the wizard
  // itself already requires before it ever creates a draft
  // (isStep1Complete). Enforcing it here, the same way propertyType already
  // is, means a nameless tariff can't exist at all rather than existing
  // and being reported as incomplete.
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  // Code from LOV category TARIFF_UNIT_TYPE (Lookup Field Master).
  @IsString()
  @IsNotEmpty()
  propertyType!: string;

  @IsEnum(TariffRateType)
  rateType!: TariffRateType;

  @IsEnum(TariffApplicability)
  applicability!: TariffApplicability;

  // Optional at create time — the wizard creates the draft record after
  // Step 1 (before rate values are entered in Step 2), so the entity itself
  // can serve as the draft from the earliest possible point instead of
  // browser storage. Completeness is enforced later, at submit() time,
  // against the persisted entity (see TariffService.getValidationIssues).
  // Min(0.0001), not Min(0) — same reasoning as TariffTierDto.ratePerKwh.
  @ValidateIf((o) => o.rateType === TariffRateType.FLAT)
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Max(RATE_MAX)
  flatRate?: number;

  @ValidateIf((o) => o.rateType === TariffRateType.TIERED)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TariffTierDto)
  tiers?: TariffTierDto[];

  // @IsOptional() matters here even though scope is conditionally mandatory
  // per applicability — a Draft is allowed to have no scope selected yet
  // (PDF Scenario 1). getValidationIssues() is what actually enforces "this
  // is required before submit", not DTO validation; without @IsOptional(),
  // @ValidateIf's condition being true would make @IsArray() reject a
  // property/unit-scoped draft outright for omitting it, which blocks the
  // very incompleteness this DTO is supposed to allow.
  @ValidateIf((o) => o.applicability === TariffApplicability.PROPERTY)
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  propertyIds?: number[];

  @ValidateIf((o) => o.applicability === TariffApplicability.UNIT)
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  unitIds?: number[];

  // No `= 0`-style default initializers here, deliberately: UpdateTariffDto
  // extends PartialType(CreateTariffDto) and inherits these same field
  // declarations, so a class-level default would make the field silently
  // materialize (e.g. `0`) on every UpdateTariffDto instance even when a
  // request omits it — indistinguishable from the client explicitly sending
  // it. That breaks both assertActiveEditAllowed's "was this locked field
  // touched" check and update()'s `dto.field ?? existing.field` merge
  // (which would then reset the field to 0 whenever it's simply left off).
  // create()'s own `dto.field ?? 0` fallback covers the actual default.
  //
  // 0 is a legitimate value for every fee/penalty below (unlike the core
  // rate) — a business is always free to waive a one-time charge or not
  // enforce a penalty. Only the recurring monthly fee gets its own,
  // smaller ceiling; everything else here is one-time.
  @IsOptional() @IsNumber() @Min(0) @Max(RECURRING_FEE_MAX) billingServiceFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(ONE_TIME_FEE_MAX) activationFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(ONE_TIME_FEE_MAX) securityDeposit?: number;

  @IsOptional() @IsEnum(TariffPenaltyType) latePaymentPenaltyType?: TariffPenaltyType;
  // See IsAmountOrPercentage's own comment — this replaces a
  // @ValidateIf(...)-gated @Max(100) that silently skipped @Min(0) too
  // whenever the type was FLAT, leaving that branch completely unvalidated.
  @IsOptional()
  @IsAmountOrPercentage('latePaymentPenaltyType', TariffPenaltyType.PERCENTAGE, PENALTY_FEE_MAX)
  latePaymentPenalty?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(PENALTY_FEE_MAX) disconnectionFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(PENALTY_FEE_MAX) reconnectionFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(PENALTY_FEE_MAX) tamperingPenalty?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(PENALTY_FEE_MAX) bouncedChequeFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(ONE_TIME_FEE_MAX) nocFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(ONE_TIME_FEE_MAX) moveOutFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(ONE_TIME_FEE_MAX) meterVerificationFee?: number;

  @IsOptional() @IsBoolean() meterRentalEnabled?: boolean;
  // Toggling rental billing on with a $0 fee is functionally the same as
  // leaving it off — IsPositiveWhenEnabled catches that inconsistency
  // without requiring a fee at all while the toggle is off.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(RECURRING_FEE_MAX)
  @IsPositiveWhenEnabled('meterRentalEnabled')
  meterRentalFee?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(100) vat?: number;

  @IsOptional() @IsString() @Length(15, 15) vatRegistrationNumber?: string;

  @ApiPropertyOptional({ enum: VatApplicableFeeKey, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(Object.values(VatApplicableFeeKey).length)
  @IsEnum(VatApplicableFeeKey, { each: true })
  vatApplicableFees?: string[];

  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsString() effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateTariffDto extends PartialType(CreateTariffDto) {
  // Mandatory only when editing a tariff that is currently PENDING or
  // REQUEST_FOR_CORRECTION — see TariffService.update() (PDF Scenario 2:
  // "Audit log: Yes — change reason mandatory").
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeReason?: string;
}

export class RejectTariffDto {
  // Code from LOV category TARIFF_REJECTION_REASON (Lookup Field Master) —
  // cross-checked against live values the same way propertyType is (see
  // TariffService.assertValidRejectionReason). @IsNotEmpty() matters here:
  // without it, an empty string satisfies @IsString() and would record a
  // reviewer decision with no actual reason on the audit trail.
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  rejectionReason!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  rejectionNotes!: string;
}

export class TariffQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ enum: TariffStatus })
  @IsOptional()
  @IsEnum(TariffStatus)
  status?: TariffStatus;

  @ApiPropertyOptional({ description: 'Unit type code from LOV category TARIFF_UNIT_TYPE' })
  @IsOptional()
  @IsString()
  propertyType?: string;

  @ApiPropertyOptional({ enum: TariffRateType })
  @IsOptional()
  @IsEnum(TariffRateType)
  rateType?: TariffRateType;

  @ApiPropertyOptional({ enum: TariffApplicability })
  @IsOptional()
  @IsEnum(TariffApplicability)
  applicability?: TariffApplicability;
}

export class TariffConflictQueryDto {
  @ApiPropertyOptional({ description: 'Unit type code from LOV category TARIFF_UNIT_TYPE' })
  @IsString()
  @IsNotEmpty()
  propertyType!: string;

  @ApiPropertyOptional({ enum: TariffApplicability })
  @IsEnum(TariffApplicability)
  applicability!: TariffApplicability;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value.map(Number) : [Number(value)]))
  @IsArray()
  @IsInt({ each: true })
  propertyIds?: number[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value.map(Number) : [Number(value)]))
  @IsArray()
  @IsInt({ each: true })
  unitIds?: number[];

  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsString() effectiveTo?: string;

  @ApiPropertyOptional({ description: 'Exclude this tariff id from the conflict check (edit mode)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  excludeId?: number;
}
