import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from "@nestjs/swagger";

import {
  Matches,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsNumber,
} from "class-validator";

export class CreateUserDto {
  @ApiProperty()
  @IsNumber()
  roleId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  businessRoleId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  reportingManagerId?: number;

  @ApiProperty({
    example: "Fernando",
  })
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @ApiPropertyOptional({
    example: "A",
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  middleName?: string;

  @ApiProperty({
    example: "Jamil",
  })
  @IsString()
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({
    example:
      "Senior Billing Executive",
  })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  designation?: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @ApiPropertyOptional({
    example: "+971501234567",
  })
  @IsOptional()
  @IsString()
  @Matches(
    /^\+\d{8,15}$/,
    {
      message:
        "Mobile number must be in international format. Example: +971501234567",
    },
  )
  mobile?: string;

  @ApiPropertyOptional({
    minLength: 8,
  })
  @IsString()
  @IsOptional()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @ApiPropertyOptional({
    example: "EMP001",
  })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  employeeCode?: string;
}

export class UpdateUserDto extends PartialType(
  CreateUserDto,
) { }