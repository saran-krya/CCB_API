import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { PropertyStatus, PropertyType } from '../entities/property.entity';

export class CreatePropertyDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  communityId!: number;

  @ApiProperty({ example: 'Rivera Tower A' })
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'RIV-T01' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiPropertyOptional({ enum: PropertyType, default: PropertyType.RESIDENTIAL })
  @IsEnum(PropertyType)
  @IsOptional()
  propertyType?: PropertyType;

  @ApiPropertyOptional({ example: 24 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  numberOfFloors?: number;

  @ApiPropertyOptional({ enum: PropertyStatus, default: PropertyStatus.ACTIVE })
  @IsEnum(PropertyStatus)
  @IsOptional()
  status?: PropertyStatus;

  @ApiPropertyOptional({ example: 'Residential tower with 24 floors.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'Al Jadaf, Dubai' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: 'Plot 123, Al Jadaf Road' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'Dubai' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'Dubai' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: '00000' })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  zipCode?: string;

  @ApiPropertyOptional({ example: 'UAE' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: 'John Smith' })
  @IsString()
  @MaxLength(160)
  @IsOptional()
  contactPerson?: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsString()
  @MaxLength(160)
  @IsOptional()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+971501234567' })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  contactPhone?: string;
}

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {}

export class UpdatePropertyStatusDto {
  @ApiProperty({ enum: PropertyStatus })
  @IsEnum(PropertyStatus)
  status!: PropertyStatus;
}

export class PropertyQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  communityId?: number;

  @ApiPropertyOptional({ enum: PropertyType })
  @IsEnum(PropertyType)
  @IsOptional()
  propertyType?: PropertyType;

  @ApiPropertyOptional({ enum: PropertyStatus })
  @IsEnum(PropertyStatus)
  @IsOptional()
  status?: PropertyStatus;
}
