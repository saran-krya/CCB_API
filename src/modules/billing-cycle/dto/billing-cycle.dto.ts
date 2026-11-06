import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { DEFAULT_LIMIT, MIN_LIMIT } from '../../../common/constants/pagination.constants';
import { MAX_DAY_OF_MONTH, MAX_OFFSET_DAYS } from '../billing-cycle.constants';

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

  @ApiProperty({ minimum: 1, maximum: MAX_DAY_OF_MONTH })
  @IsInt()
  @Min(1)
  @Max(MAX_DAY_OF_MONTH)
  @Type(() => Number)
  readingStartDay!: number;

  @ApiProperty({ minimum: 1, maximum: MAX_DAY_OF_MONTH })
  @IsInt()
  @Min(1)
  @Max(MAX_DAY_OF_MONTH)
  @Type(() => Number)
  readingEndDay!: number;

  @ApiProperty({ minimum: 0, maximum: MAX_OFFSET_DAYS })
  @IsInt()
  @Min(0)
  @Max(MAX_OFFSET_DAYS)
  @Type(() => Number)
  billGenerationDays!: number;

  @ApiProperty({ minimum: 0, maximum: MAX_OFFSET_DAYS })
  @IsInt()
  @Min(0)
  @Max(MAX_OFFSET_DAYS)
  @Type(() => Number)
  billIssueDays!: number;

  @ApiProperty({ minimum: 1, maximum: MAX_OFFSET_DAYS })
  @IsInt()
  @Min(1)
  @Max(MAX_OFFSET_DAYS)
  @Type(() => Number)
  billDueDays!: number;

  @ApiPropertyOptional({ enum: BillingCycleStatus })
  @IsOptional()
  @IsEnum(BillingCycleStatus)
  status?: BillingCycleStatus;
}

export class NewVersionBillingCycleDto {
  @ApiProperty({ minimum: 1, maximum: MAX_DAY_OF_MONTH })
  @IsInt()
  @Min(1)
  @Max(MAX_DAY_OF_MONTH)
  @Type(() => Number)
  readingStartDay!: number;

  @ApiProperty({ minimum: 1, maximum: MAX_DAY_OF_MONTH })
  @IsInt()
  @Min(1)
  @Max(MAX_DAY_OF_MONTH)
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

  @ApiProperty({ description: 'Confirms the user understands billing will stop for this property' })
  @IsBoolean()
  acknowledged!: boolean;
}

export class BillingCycleQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ default: DEFAULT_LIMIT, minimum: MIN_LIMIT, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(MIN_LIMIT)
  @Max(1000)
  @Type(() => Number)
  override limit = DEFAULT_LIMIT;

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

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_DAY_OF_MONTH })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DAY_OF_MONTH)
  @Type(() => Number)
  readingStartDay?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_DAY_OF_MONTH })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DAY_OF_MONTH)
  @Type(() => Number)
  readingEndDay?: number;
}
