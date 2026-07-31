import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OccupancyStatus, UnitStatus, UnitType } from '../../unit/entities/unit.entity';
import { PropertyStatus, PropertyType } from '../entities/property.entity';

export class PropertyListDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiPropertyOptional() businessCode!: string | null;
  @ApiProperty({ enum: PropertyType }) propertyType!: PropertyType;
  @ApiProperty() numberOfFloors!: number;
  @ApiProperty() totalUnits!: number;
  @ApiProperty({ enum: PropertyStatus }) status!: PropertyStatus;
  @ApiProperty({ description: 'ISO-8601 date string' }) createdDate!: string;
  @ApiProperty() communityId!: number;
  @ApiProperty() communityName!: string;
}

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

export class PropertyDetailDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiPropertyOptional() businessCode!: string | null;
  @ApiProperty({ enum: PropertyType }) propertyType!: PropertyType;
  @ApiProperty() numberOfFloors!: number;
  @ApiProperty({ enum: PropertyStatus }) status!: PropertyStatus;
  @ApiPropertyOptional() description!: string | null;
  @ApiProperty({ description: 'ISO-8601 date string' }) createdDate!: string;
  @ApiPropertyOptional() location!: string | null;
  @ApiPropertyOptional() address!: string | null;
  @ApiPropertyOptional() city!: string | null;
  @ApiPropertyOptional() state!: string | null;
  @ApiPropertyOptional() zipCode!: string | null;
  @ApiPropertyOptional() country!: string | null;
  @ApiPropertyOptional() contactPerson!: string | null;
  @ApiPropertyOptional() contactEmail!: string | null;
  @ApiPropertyOptional() contactPhone!: string | null;
  @ApiProperty() communityId!: number;
  @ApiProperty() communityName!: string;
  @ApiProperty() totalUnits!: number;
  @ApiProperty() residentialUnits!: number;
  @ApiProperty() commercialUnits!: number;
  @ApiProperty() occupiedUnits!: number;
  @ApiProperty() vacantUnits!: number;
  @ApiProperty() totalSubMeters!: number;
  @ApiProperty() mappedMeters!: number;
  @ApiProperty() unmappedMeters!: number;
  @ApiProperty({ type: () => [PropertyUnitDto] }) units!: PropertyUnitDto[];
}
