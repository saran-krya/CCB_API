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

  @ApiPropertyOptional({ enum: ['clean', 'anomaly', 'missing'] })
  @IsOptional()
  @IsIn(['clean', 'anomaly', 'missing'])
  validationStatus?: DailyReadingValidationStatus;

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
