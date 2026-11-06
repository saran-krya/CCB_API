import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SaveRoleWithPermissionsDto {
  @ApiProperty({
    example: 'EXAMPLE_ROLE',
  })
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
    description:
      'User Category Id',
  })
  @IsNumber()
  userCategoryId!: number;

  @ApiPropertyOptional({
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  canBeReportingManager?: boolean;

  @ApiPropertyOptional({
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  canBeFieldInspector?: boolean;

  @ApiProperty({
    type: [Object],
    description:
      'Permission tree payload',
  })
  @IsArray()
  screenPermissionList!: any[];
}