import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateUnitDto {
  @ApiProperty()
  propertyId!: number;

  @ApiProperty({ example: '1204' })
  @IsString()
  @MaxLength(60)
  unitNo!: string;

  @ApiProperty({ example: '2BR' })
  @IsString()
  @MaxLength(80)
  unitType!: string;

  @ApiProperty({ example: 1350.5 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  area!: number;

  @ApiProperty({ example: 'TENANTED' })
  @IsString()
  @MaxLength(80)
  occupancyType!: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  status?: boolean;
}

export class UpdateUnitDto extends PartialType(CreateUnitDto) {}