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
    description:
      'User Category Id',
  })
  @IsNumber()
  userCategoryId!: number;

  @ApiProperty({
    example: 1,
    description:
      'User Type Id',
  })
  @IsNumber()
  userTypeId!: number;

  @ApiPropertyOptional({
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  canBeReportingManager?: boolean;

  @ApiProperty({
    type: [Object],
    description:
      'Permission tree payload',
  })
  @IsArray()
  screenPermissionList!: any[];
}