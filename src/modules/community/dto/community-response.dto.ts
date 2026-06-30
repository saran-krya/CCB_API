import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PropertyStatus, PropertyType } from '../../property/entities/property.entity';
import { CommunityStatus } from '../entities/community.entity';

/** Returned by GET /communities (list row) */
export class CommunityListDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiPropertyOptional() location!: string | null;
  @ApiProperty() totalProperties!: number;
  @ApiProperty() totalUnits!: number;
  @ApiProperty({ enum: CommunityStatus }) status!: CommunityStatus;
  @ApiProperty({ description: 'ISO-8601 date string' }) createdDate!: string;
  @ApiPropertyOptional() city!: string | null;
  @ApiPropertyOptional() state!: string | null;
  @ApiPropertyOptional() country!: string | null;
}

/** Lightweight property row embedded inside CommunityDetailDto */
export class CommunityPropertyDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: PropertyType }) propertyType!: PropertyType;
  @ApiProperty() numberOfFloors!: number;
  @ApiProperty({ enum: PropertyStatus }) status!: PropertyStatus;
  @ApiProperty() totalUnits!: number;
}

/** Returned by GET /communities/:id (full detail) */
export class CommunityDetailDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: CommunityStatus }) status!: CommunityStatus;
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
  // Stats cards
  @ApiProperty() totalProperties!: number;
  @ApiProperty() totalUnits!: number;
  @ApiProperty() residentialUnits!: number;
  @ApiProperty() commercialUnits!: number;
  @ApiProperty() occupiedUnits!: number;
  @ApiProperty() vacantUnits!: number;
  // Meter stats (placeholder until meter module; always 0)
  @ApiProperty() totalMasterMeters!: number;
  @ApiProperty() totalSubMeters!: number;
  @ApiProperty() mappedMeters!: number;
  @ApiProperty() unmappedMeters!: number;
  // Embedded property list (PropertiesTable)
  @ApiProperty({ type: () => [CommunityPropertyDto] }) properties!: CommunityPropertyDto[];
}
