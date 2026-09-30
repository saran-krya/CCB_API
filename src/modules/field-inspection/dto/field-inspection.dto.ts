import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class FieldInspectionQueryDto {
  @ApiPropertyOptional({ description: 'Omit to return every property\'s requests' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  propertyId?: number;
}

export class SelectableReadingsQueryDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  propertyId!: number;
}

export class CreateFieldInspectionRequestDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  propertyId!: number;

  @ApiProperty({ description: 'LOV code, category FIELD_INSPECTION_TYPE' })
  @IsString()
  inspectionType!: string;

  @ApiProperty({ description: 'LOV code, category FIELD_INSPECTION_PRIORITY' })
  @IsString()
  priority!: string;

  @ApiProperty()
  @IsString()
  @MinLength(20)
  description!: string;

  @ApiProperty()
  @IsDateString()
  inspectionDate!: string;

  @ApiProperty({ description: 'A real User id — must hold a role with canBeFieldInspector' })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  assignedToUserId!: number;

  @ApiPropertyOptional({ type: [String], description: 'LOV codes, category FIELD_INSPECTION_NOTIFY_ROLE' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notify?: string[];

  @ApiProperty()
  @IsDateString()
  resolutionBy!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [Number], description: 'MeterReading ids this request covers' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  meterReadingIds!: number[];
}
