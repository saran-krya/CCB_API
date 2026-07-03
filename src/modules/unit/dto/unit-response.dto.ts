import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OccupancyStatus, UnitStatus, UnitType } from '../entities/unit.entity';

/** Returned by GET /units (list row) */
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

/** Returned by GET /units/:id (full detail) */
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
  // Stat card
  @ApiPropertyOptional() monthlyRent!: number | null;
  // Unit Configuration card
  @ApiPropertyOptional() bedrooms!: number | null;
  @ApiPropertyOptional() bathrooms!: number | null;
  @ApiProperty() parkingSpaces!: number;
  @ApiProperty() balcony!: boolean;
  // Occupancy & Dates card
  @ApiPropertyOptional({ description: 'ISO-8601 date string' }) handoverDate!: string | null;
  @ApiPropertyOptional() ownerId!: string | null;
  @ApiPropertyOptional() tenantId!: string | null;
  // Meter Information card
  @ApiPropertyOptional() masterMeterId!: string | null;
  @ApiPropertyOptional() subMeterId!: string | null;
  // Amenities card
  @ApiPropertyOptional({ type: [String] }) amenities!: string[] | null;
  @ApiPropertyOptional() description!: string | null;
  // Breadcrumb context
  @ApiProperty() propertyId!: number;
  @ApiProperty() propertyName!: string;
  @ApiProperty() propertyCode!: string;
  @ApiProperty() communityId!: number;
  @ApiProperty() communityName!: string;
}
