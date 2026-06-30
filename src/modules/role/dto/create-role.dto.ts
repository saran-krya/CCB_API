import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';

import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({
    example: 'ADMIN',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  roleName!: string;

  @ApiPropertyOptional({
    example:
      'System Administrator Role',
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

  @ApiProperty({
    example: 1,
  })
  @IsNumber()
  userTypeId!: number;

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