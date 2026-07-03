import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class GetLovDto {
  @ApiPropertyOptional({ description: 'Filter by category (e.g. BILLING_FREQUENCY)' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Include inactive values (default: active only)', default: false })
  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateLovDto {
  @ApiProperty({ description: 'Category key in UPPER_SNAKE_CASE (e.g. BILLING_FREQUENCY)' })
  @IsString()
  category!: string;

  @ApiProperty({ description: 'Value code (e.g. monthly)' })
  @IsString()
  code!: string;

  @ApiProperty({ description: 'Display label (e.g. Monthly)' })
  @IsString()
  label!: string;

  @ApiProperty({ default: 0, description: 'Sort order within the category' })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  displayOrder!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateLovDto extends PartialType(CreateLovDto) {}
