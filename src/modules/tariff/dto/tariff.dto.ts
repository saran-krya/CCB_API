import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import {
  TariffApplicability,
  TariffPropertyType,
  TariffRateType,
  TariffStatus,
} from '../entities/tariff.entity';

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

  @IsEnum(TariffPropertyType)
  propertyType!: TariffPropertyType;

  @IsEnum(TariffRateType)
  rateType!: TariffRateType;

  @IsEnum(TariffApplicability)
  applicability!: TariffApplicability;

  @ValidateIf((o) => o.rateType === TariffRateType.FLAT)
  @IsNumber()
  @Min(0)
  flatRate?: number;

  @ValidateIf((o) => o.rateType === TariffRateType.TIERED)
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
  @IsOptional() @IsNumber() @Min(0) latePaymentPenalty?: number = 0;
  @IsOptional() @IsNumber() @Min(0) disconnectionFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) reconnectionFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) tamperingPenalty?: number = 0;
  @IsOptional() @IsNumber() @Min(0) nocFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) moveOutFee?: number = 0;
  @IsOptional() @IsNumber() @Min(0) @Max(100) vat?: number = 5;

  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsString() effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateTariffDto extends PartialType(CreateTariffDto) {}

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

  @ApiPropertyOptional({ enum: TariffPropertyType })
  @IsOptional()
  @IsEnum(TariffPropertyType)
  propertyType?: TariffPropertyType;

  @ApiPropertyOptional({ enum: TariffRateType })
  @IsOptional()
  @IsEnum(TariffRateType)
  rateType?: TariffRateType;

  @ApiPropertyOptional({ enum: TariffApplicability })
  @IsOptional()
  @IsEnum(TariffApplicability)
  applicability?: TariffApplicability;
}
