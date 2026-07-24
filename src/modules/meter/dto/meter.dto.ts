import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { MeterStatus } from '../entities/meter-status.enum';
import { ImportFailureReason } from '../entities/import-result.types';
import { CommunityStatus } from '../../community/entities/community.entity';
import { PropertyStatus } from '../../property/entities/property.entity';
import { UnitStatus } from '../../unit/entities/unit.entity';

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
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(MeterStatus)
  status?: MeterStatus;
}

// ─── Meter Information — paginated Communities / Properties overview ────────
// `search` (inherited from BasePaginationDto) matches by name; `sortBy` is
// whitelisted server-side to real base-table columns only (name, status) —
// the coverage/count columns are computed via separate grouped queries per
// page of results, not part of the base table, so they aren't sortable.

// The "All" option in the status filter dropdown clears the filter by
// sending status="" rather than omitting the param — @IsOptional() only
// skips validation when the value is undefined, not for an empty string, so
// without this transform @IsEnum() rejects "" with a 400 and the table
// renders empty. Blank out empty strings to undefined before @IsEnum runs.
const emptyStringToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class MeterCommunitiesOverviewQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ enum: CommunityStatus })
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsEnum(CommunityStatus)
  status?: CommunityStatus;
}

export class MeterPropertiesOverviewQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ enum: PropertyStatus })
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsEnum(PropertyStatus)
  status?: PropertyStatus;
}

export class MeterUnitsOverviewQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ enum: UnitStatus })
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsEnum(UnitStatus)
  status?: UnitStatus;
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

  @ApiPropertyOptional({ example: 'importedAt', description: 'Field to sort by' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC';
}

export class DailyMeterReadingSummaryQueryDto {
  @ApiPropertyOptional({ description: 'Reading date (YYYY-MM-DD) — defaults to today' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  communityId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  propertyId?: number;
}

// ─── Daily Meter Readings — paginated, filterable list ──────────────────────

export type DailyReadingValidationStatus = 'clean' | 'anomaly' | 'missing';

export class DailyMeterReadingQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ description: 'Reading date (YYYY-MM-DD) — defaults to today' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  communityId?: number;

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

  // 'anomaly' always returns an empty page today — invalid rows are never
  // persisted as MeterReading, so no anomalous reading can ever be found
  // this way (see DailyMeterReadingsService.getDailyMeterReadings). 'missing'
  // is synthesized separately by diffing the SubMeter registry against
  // meter_ids that actually reported for the date.
  @ApiPropertyOptional({ enum: ['clean', 'anomaly', 'missing'] })
  @IsOptional()
  @IsIn(['clean', 'anomaly', 'missing'])
  validationStatus?: DailyReadingValidationStatus;

  // Accepted for forward compatibility with the UI's existing filter bar —
  // no billing_status data exists anywhere yet (billing logic is explicitly
  // out of scope for this milestone), so this currently has no effect.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingStatus?: string;

  @ApiPropertyOptional({ example: 'readingDate', description: 'Field to sort by' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC';
}
