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
import {
  TariffApplicability,
  TariffPenaltyType,
  TariffRateType,
  TariffStatus,
} from '../entities/tariff.entity';

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
  @Min(0)
  ratePerKwh!: number;
}

export class CreateTariffDto {
  @IsString()
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
  // against the persisted entity (see validateRateShapeForEntity).
  @ValidateIf((o) => o.rateType === TariffRateType.FLAT)
  @IsOptional()
  @IsNumber()
  @Min(0)
  flatRate?: number;

  @ValidateIf((o) => o.rateType === TariffRateType.TIERED)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TariffTierDto)
  tiers?: TariffTierDto[];

  @ValidateIf((o) => o.applicability === TariffApplicability.PROPERTY)
  @IsArray()
  @IsInt({ each: true })
  propertyIds?: number[];

  @ValidateIf((o) => o.applicability === TariffApplicability.UNIT)
  @IsArray()
  @IsInt({ each: true })
  unitIds?: number[];

  @IsOptional() @IsNumber() @Min(0) billingServiceFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) activationFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) securityDeposit?: number = 0;

  @IsOptional() @IsEnum(TariffPenaltyType) latePaymentPenaltyType?: TariffPenaltyType = TariffPenaltyType.FLAT;
  @IsOptional() @IsNumber() @Min(0)
  @ValidateIf((o) => o.latePaymentPenaltyType === TariffPenaltyType.PERCENTAGE)
  @Max(100)
  latePaymentPenalty?: number = 0;

  @IsOptional() @IsNumber() @Min(0) disconnectionFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) reconnectionFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) tamperingPenalty?: number = 0;
  @IsOptional() @IsNumber() @Min(0) bouncedChequeFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) nocFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) moveOutFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) meterVerificationFee?: number = 0;

  @IsOptional() @IsBoolean() meterRentalEnabled?: boolean = false;
  @IsOptional() @IsNumber() @Min(0) meterRentalFee?: number = 0;

  @IsOptional() @IsNumber() @Min(0) @Max(100) vat?: number = 5;

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
  @IsString()
  @MaxLength(100)
  rejectionReason!: string;

  @IsString()
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
