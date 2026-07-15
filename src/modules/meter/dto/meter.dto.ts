import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { MeterStatus } from '../entities/meter-status.enum';
import { ImportFailureReason } from '../entities/import-result.types';

export class CreateMasterMeterDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dtuId?: string;

  @Type(() => Number)
  @IsInt()
  propertyId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mBusAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  meterMake?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  meterModel?: string;

  @IsOptional()
  @IsDateString()
  installationDate?: string;
}

export class UpdateMasterMeterDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dtuId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mBusAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  meterMake?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  meterModel?: string;

  @IsOptional()
  @IsDateString()
  installationDate?: string;
}

export class SetMeterStatusDto {
  @IsEnum(MeterStatus)
  status!: MeterStatus;
}

export class CreateSubMeterDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;

  @Type(() => Number)
  @IsInt()
  masterMeterId!: number;

  @Type(() => Number)
  @IsInt()
  propertyId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mBusAddress?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  meterMake?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  meterModel?: string;

  @IsOptional()
  @IsDateString()
  installationDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerAccountNumber?: string;
}

export class UpdateSubMeterDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mBusAddress?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  meterMake?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  meterModel?: string;

  @IsOptional()
  @IsDateString()
  installationDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerAccountNumber?: string;
}

export class MeterQueryDto extends BasePaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  propertyId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  communityId?: number;

  @ApiPropertyOptional({ enum: MeterStatus })
  @IsOptional()
  @IsEnum(MeterStatus)
  status?: MeterStatus;
}

// ─── Import result report generation ────────────────────────────────────────
// The frontend already holds the full ImportSummary returned by the import
// endpoint (failedRecords with their original cell values, importedIds) —
// these two DTOs just carry that same data back to the server so the actual
// .xlsx generation stays server-side (ExcelJS, same as the template/export
// endpoints), rather than duplicating workbook-building logic in the browser.

export class ImportFailedRecordDto {
  @IsNumber()
  rowNumber!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsEnum(ImportFailureReason)
  reasonType!: ImportFailureReason;

  @IsObject()
  values!: Record<string, string | null>;
}

export class DownloadErrorReportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportFailedRecordDto)
  failedRecords!: ImportFailedRecordDto[];

  @IsOptional()
  @IsString()
  batchId?: string;
}

export class DownloadSuccessReportDto {
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  ids!: number[];
}

// ─── Import Center — filtered/paginated import history ──────────────────────

export class ImportHistoryQueryDto {
  @ApiPropertyOptional({ enum: ['master_meter', 'sub_meter'] })
  @IsOptional()
  @IsEnum(['master_meter', 'sub_meter'])
  type?: 'master_meter' | 'sub_meter';

  @ApiPropertyOptional({ enum: ['success', 'failed', 'partial'] })
  @IsOptional()
  @IsEnum(['success', 'failed', 'partial'])
  status?: 'success' | 'failed' | 'partial';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pageSize?: number;
}
