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
  @IsNumber()
  @Min(0)
  minKwh!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxKwh?: number | null;

  @IsNumber()
  @Min(0.0001)
  @Max(RATE_MAX)
  ratePerKwh!: number;
}

export class CreateTariffDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsString()
  @IsNotEmpty()
  propertyType!: string;

  @IsEnum(TariffRateType)
  rateType!: TariffRateType;

  @IsEnum(TariffApplicability)
  applicability!: TariffApplicability;

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

  @IsOptional() @IsNumber() @Min(0) @Max(RECURRING_FEE_MAX) billingServiceFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(ONE_TIME_FEE_MAX) activationFee?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(ONE_TIME_FEE_MAX) securityDeposit?: number;

  @IsOptional() @IsEnum(TariffPenaltyType) latePaymentPenaltyType?: TariffPenaltyType;
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
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeReason?: string;
}

export class RejectTariffDto {
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
