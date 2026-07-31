import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OccupancyStatus, UnitStatus, UnitType } from '../entities/unit.entity';

export class UnitListDto {
  @ApiProperty() id!: number;
  @ApiProperty() unitNumber!: string;
  @ApiPropertyOptional() businessCode!: string | null;
  @ApiProperty() floorNumber!: number;
  @ApiProperty({ enum: UnitType }) unitType!: UnitType;
  @ApiPropertyOptional({ description: 'sq ft' }) unitSize!: number | null;
  @ApiProperty({ enum: OccupancyStatus }) occupancyStatus!: OccupancyStatus;
  @ApiProperty({ enum: UnitStatus }) status!: UnitStatus;
  @ApiProperty({ description: 'ISO-8601 date string' }) createdDate!: string;
  @ApiProperty() propertyId!: number;
  @ApiProperty() propertyName!: string;
  @ApiProperty() communityId!: number;
  @ApiProperty() communityName!: string;
}

export class UnitDetailDto {
  @ApiProperty() id!: number;
  @ApiProperty() unitNumber!: string;
  @ApiPropertyOptional() businessCode!: string | null;
  @ApiProperty() floorNumber!: number;
  @ApiProperty({ enum: UnitType }) unitType!: UnitType;
  @ApiPropertyOptional({ description: 'sq ft' }) unitSize!: number | null;
  @ApiProperty({ enum: OccupancyStatus }) occupancyStatus!: OccupancyStatus;
  @ApiProperty({ enum: UnitStatus }) status!: UnitStatus;
  @ApiProperty({ description: 'ISO-8601 date string' }) createdDate!: string;
  @ApiPropertyOptional() monthlyRent!: number | null;
  @ApiPropertyOptional() bedrooms!: number | null;
  @ApiPropertyOptional() bathrooms!: number | null;
  @ApiProperty() parkingSpaces!: number;
  @ApiProperty() balcony!: boolean;
  @ApiPropertyOptional({ description: 'ISO-8601 date string' }) handoverDate!: string | null;
  @ApiPropertyOptional() ownerId!: string | null;
  @ApiPropertyOptional() tenantId!: string | null;
  @ApiPropertyOptional() masterMeterId!: number | null;
  @ApiPropertyOptional() masterMeterCode!: string | null;
  @ApiPropertyOptional() subMeterId!: number | null;
  @ApiPropertyOptional() subMeterCode!: string | null;
  @ApiPropertyOptional({ type: [String] }) amenities!: string[] | null;
  @ApiPropertyOptional() description!: string | null;
  @ApiProperty() propertyId!: number;
  @ApiProperty() propertyName!: string;
  @ApiProperty() propertyCode!: string;
  @ApiProperty() communityId!: number;
  @ApiProperty() communityName!: string;
}
