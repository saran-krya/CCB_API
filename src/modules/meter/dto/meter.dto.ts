import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { MeterStatus } from '../entities/meter-status.enum';

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
