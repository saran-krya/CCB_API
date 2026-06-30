import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OccupancyStatus, UnitStatus, UnitType } from '../../unit/entities/unit.entity';
import { PropertyStatus, PropertyType } from '../entities/property.entity';

/** Returned by GET /properties (list row) */
export class PropertyListDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: PropertyType }) propertyType!: PropertyType;
  @ApiProperty() numberOfFloors!: number;
  @ApiProperty() totalUnits!: number;
  @ApiProperty({ enum: PropertyStatus }) status!: PropertyStatus;
  @ApiProperty({ description: 'ISO-8601 date string' }) createdDate!: string;
  @ApiProperty() communityId!: number;
  @ApiProperty() communityName!: string;
}

/** Lightweight unit row embedded inside PropertyDetailDto (UnitsTable) */
export class PropertyUnitDto {
  @ApiProperty() id!: number;
  @ApiProperty() unitNumber!: string;
  @ApiProperty() floorNumber!: number;
  @ApiProperty({ enum: UnitType }) unitType!: UnitType;
  @ApiPropertyOptional() unitSize!: number | null;
  @ApiProperty({ enum: OccupancyStatus }) occupancyStatus!: OccupancyStatus;
  @ApiProperty({ enum: UnitStatus }) status!: UnitStatus;
  @ApiPropertyOptional() bedrooms!: number | null;
  @ApiPropertyOptional() bathrooms!: number | null;
  @ApiPropertyOptional() monthlyRent!: number | null;
}

/** Returned by GET /properties/:id (full detail) */
export class PropertyDetailDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: PropertyType }) propertyType!: PropertyType;
  @ApiProperty() numberOfFloors!: number;
  @ApiProperty({ enum: PropertyStatus }) status!: PropertyStatus;
  @ApiPropertyOptional() description!: string | null;
  @ApiProperty({ description: 'ISO-8601 date string' }) createdDate!: string;
  // Location
  @ApiPropertyOptional() location!: string | null;
  @ApiPropertyOptional() address!: string | null;
  @ApiPropertyOptional() city!: string | null;
  @ApiPropertyOptional() state!: string | null;
  @ApiPropertyOptional() zipCode!: string | null;
  @ApiPropertyOptional() country!: string | null;
  // Contact
  @ApiPropertyOptional() contactPerson!: string | null;
  @ApiPropertyOptional() contactEmail!: string | null;
  @ApiPropertyOptional() contactPhone!: string | null;
  // Community context
  @ApiProperty() communityId!: number;
  @ApiProperty() communityName!: string;
  // Stats cards
  @ApiProperty() totalUnits!: number;
  @ApiProperty() residentialUnits!: number;
  @ApiProperty() commercialUnits!: number;
  @ApiProperty() occupiedUnits!: number;
  @ApiProperty() vacantUnits!: number;
  // Building Info card (placeholder until meter module; always 0)
  @ApiProperty() totalSubMeters!: number;
  @ApiProperty() mappedMeters!: number;
  @ApiProperty() unmappedMeters!: number;
  // Embedded unit list (UnitsTable)
  @ApiProperty({ type: () => [PropertyUnitDto] }) units!: PropertyUnitDto[];
}
