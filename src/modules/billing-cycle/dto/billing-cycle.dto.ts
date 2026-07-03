import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { BillingCycleStatus } from '../entities/billing-cycle.entity';

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

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  billGenerationDays!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  billIssueDays!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  billDueDays!: number;

  @ApiPropertyOptional({ enum: BillingCycleStatus })
  @IsOptional()
  @IsEnum(BillingCycleStatus)
  status?: BillingCycleStatus;
}

export class UpdateBillingCycleDto extends PartialType(
  OmitType(CreateBillingCycleDto, ['propertyId', 'communityId'] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reasonForChange?: string;
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
