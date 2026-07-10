import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { BillingCycleStatus } from '../entities/billing-cycle-version.entity';

export class CreateBillingCycleDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  propertyId!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  communityId!: number;

  @ApiProperty({ description: 'Billing frequency code from LOV (e.g. monthly, quarterly, annually)' })
  @IsString()
  frequency!: string;

  @ApiProperty({ minimum: 1, maximum: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  readingStartDay!: number;

  @ApiProperty({ minimum: 1, maximum: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  readingEndDay!: number;

  @ApiProperty({ minimum: 0, maximum: 365 })
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  billGenerationDays!: number;

  @ApiProperty({ minimum: 0, maximum: 365 })
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  billIssueDays!: number;

  @ApiProperty({ minimum: 1, maximum: 365 })
  @IsInt()
  @Min(1)
  @Max(365)
  @Type(() => Number)
  billDueDays!: number;

  @ApiPropertyOptional({ enum: BillingCycleStatus })
  @IsOptional()
  @IsEnum(BillingCycleStatus)
  status?: BillingCycleStatus;
}

// readingStartDay/readingEndDay are structurally still present here (inherited
// from CreateBillingCycleDto via PartialType) but are always rejected by
// BillingCycleService.assertNoLockedFields() — Business Rule 1 locks the
// reading window unconditionally; the only way to change it is newVersion().
export class UpdateBillingCycleDto extends PartialType(
  OmitType(CreateBillingCycleDto, ['propertyId', 'communityId'] as const),
) {
  @ApiPropertyOptional({ description: 'Free-text notes explaining the change' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reasonForChange?: string;

  @ApiPropertyOptional({ description: 'Change reason code from LOV category BILLING_CYCLE_CHANGE_REASON' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reasonCode?: string;
}

// Business Rule 3/5 — the only way to change the reading window on an
// existing billing cycle: clone it into a new PENDING version awaiting
// Finance approval, effective from a future date.
export class NewVersionBillingCycleDto {
  @ApiProperty({ minimum: 1, maximum: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  readingStartDay!: number;

  @ApiProperty({ minimum: 1, maximum: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  readingEndDay!: number;

  @ApiProperty({ description: 'Date this version takes over as the governing cycle — must be in the future' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ description: 'Change reason code from LOV category BILLING_CYCLE_CHANGE_REASON' })
  @IsString()
  @IsNotEmpty()
  reasonCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectBillingCycleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  notes!: string;
}

export class DeprecateBillingCycleDto {
  @ApiProperty({ description: 'Deprecation reason code from LOV category BILLING_CYCLE_DEPRECATION_REASON' })
  @IsString()
  @IsNotEmpty()
  reasonCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Date the deprecation takes effect — defaults to today if omitted. Cannot be in the past.' })
  @IsOptional()
  @IsDateString()
  effectiveDeprecationDate?: string;

  // Mandatory on every deprecation — "user must confirm they understand
  // billing will stop for this property" (doc: Mandatory inputs before
  // deprecation is confirmed). Enforced as `=== true` in the service.
  @ApiProperty({ description: 'Confirms the user understands billing will stop for this property' })
  @IsBoolean()
  acknowledged!: boolean;
}

export class BillingCycleQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  override limit = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  communityId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  propertyId?: number;

  @ApiPropertyOptional({ description: 'Property name substring search' })
  @IsOptional()
  @IsString()
  property?: string;

  @ApiPropertyOptional({ description: 'Billing frequency code from LOV' })
  @IsOptional()
  @IsString()
  frequency?: string;

  @ApiPropertyOptional({ enum: BillingCycleStatus })
  @IsOptional()
  @IsEnum(BillingCycleStatus)
  status?: BillingCycleStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  readingStartDay?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  readingEndDay?: number;
}
