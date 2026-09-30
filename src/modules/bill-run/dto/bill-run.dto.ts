import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { BillRunStatus } from '../entities/bill-run.entity';

export class SubmitBillRunDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  propertyId!: number;

  @ApiPropertyOptional({ description: 'Optional notes for the reviewer' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// Deliberately has no propertyId — resubmit always re-targets the ORIGINAL row's own property (see
// BillRunService.resubmit), so forcing a caller to repeat a value that's already known and can only
// ever be ignored would just invite a mismatched value silently doing nothing.
export class ResubmitBillRunDto {
  @ApiPropertyOptional({ description: 'Optional notes for the reviewer' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class SubmitBatchBillRunDto {
  @ApiProperty({ type: [Number], description: 'Every property to submit together as one batch' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  propertyIds!: number[];

  @ApiPropertyOptional({ description: 'Optional notes for the reviewer, applied to every run in the batch' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReviewBillRunDto {
  @ApiPropertyOptional({ description: 'Reviewer notes/remarks' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReturnBillRunDto {
  @ApiProperty({ description: 'Required — explains what needs correcting' })
  @IsString()
  notes!: string;
}

export class RejectBillRunDto {
  @ApiProperty({ description: 'Required — reason for rejection' })
  @IsString()
  notes!: string;
}

export class BillRunQueryDto extends BasePaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  propertyId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  communityId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  batchId?: number;

  @ApiPropertyOptional({ enum: BillRunStatus })
  @IsOptional()
  @IsEnum(BillRunStatus)
  status?: BillRunStatus;
}
