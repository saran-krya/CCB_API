import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Surrounding whitespace is never part of a name: a name and the same name with trailing spaces must not be two different roles. */
const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateRoleDto {
  @ApiProperty({
    example: 'EXAMPLE_ROLE',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  roleName!: string;

  @ApiPropertyOptional({
    example:
      'Example role description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  roleDescription?: string;

  @ApiProperty({
    example: 1,
  })
  @IsNumber()
  userCategoryId!: number;

  @ApiPropertyOptional({
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  canBeReportingManager?: boolean;
}

export class UpdateRoleDto extends PartialType(
  CreateRoleDto,
) {}