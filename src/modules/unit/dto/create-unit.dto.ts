import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { OccupancyStatus, UnitStatus, UnitType } from '../entities/unit.entity';

export class CreateUnitDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  propertyId!: number;

  @ApiProperty({ example: '1204' })
  @IsString()
  @MaxLength(50)
  unitNumber!: string;

  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  floorNumber!: number;

  @ApiProperty({ enum: UnitType })
  @IsEnum(UnitType)
  unitType!: UnitType;

  @ApiPropertyOptional({ example: 1350.5 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  unitSize?: number;

  @ApiPropertyOptional({ enum: OccupancyStatus, default: OccupancyStatus.VACANT })
  @IsEnum(OccupancyStatus)
  @IsOptional()
  occupancyStatus?: OccupancyStatus;

  @ApiPropertyOptional({ enum: UnitStatus, default: UnitStatus.ACTIVE })
  @IsEnum(UnitStatus)
  @IsOptional()
  status?: UnitStatus;

  @ApiPropertyOptional({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  @IsOptional()
  bedrooms?: number;

  @ApiPropertyOptional({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  @IsOptional()
  bathrooms?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  balcony?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  parkingSpaces?: number;

  @ApiPropertyOptional({ example: 7500.0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyRent?: number;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsDateString()
  @IsOptional()
  handoverDate?: string;

  @ApiPropertyOptional({ example: 'OWN-001' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  ownerId?: string;

  @ApiPropertyOptional({ example: 'TNT-001' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  tenantId?: string;

  @ApiPropertyOptional({ example: 'MTR-M-001' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  masterMeterId?: string;

  @ApiPropertyOptional({ example: 'MTR-S-001' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  subMeterId?: string;

  @ApiPropertyOptional({ example: ['gym', 'pool', 'parking'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  amenities?: string[];

  @ApiPropertyOptional({ example: 'Corner unit with sea view.' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateUnitDto extends PartialType(CreateUnitDto) {}

export class UpdateOccupancyDto {
  @ApiProperty({ enum: OccupancyStatus })
  @IsEnum(OccupancyStatus)
  occupancyStatus!: OccupancyStatus;
}

export class UnitQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  propertyId?: number;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  communityId?: number;

  @ApiPropertyOptional({ enum: UnitType })
  @IsEnum(UnitType)
  @IsOptional()
  unitType?: UnitType;

  @ApiPropertyOptional({ enum: OccupancyStatus })
  @IsEnum(OccupancyStatus)
  @IsOptional()
  occupancyStatus?: OccupancyStatus;

  @ApiPropertyOptional({ enum: UnitStatus })
  @IsEnum(UnitStatus)
  @IsOptional()
  status?: UnitStatus;
}
