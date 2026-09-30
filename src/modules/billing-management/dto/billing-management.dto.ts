import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { BillStatus } from '../entities/bill.entity';

export class BillQueryDto extends BasePaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  billRunId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  propertyId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  communityId?: number;

  @ApiPropertyOptional({ enum: BillStatus })
  @IsOptional()
  @IsEnum(BillStatus)
  status?: BillStatus;

  @ApiPropertyOptional({ description: 'Billing period end date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  cycleEndDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC';
}

export class CancelBillDto {
  @ApiPropertyOptional({ description: 'Required — reason for cancellation' })
  @IsString()
  reason!: string;
}
