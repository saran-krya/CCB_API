import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from "@nestjs/swagger";

import {
  ArrayNotEmpty,
  ArrayUnique,
  Matches,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateUserDto {
  @ApiProperty({
    type: [Number],
    example: [2, 5],
    description:
      "Every role this user starts with — at least one, no duplicates. The first is the primary role.",
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  roleIds!: number[];

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

  @ApiPropertyOptional({
    default: false,
    description: "Forces this user to change their password the next time they sign in.",
  })
  @IsBoolean()
  @IsOptional()
  mustChangePassword?: boolean;

}

// No role field at all: roles are changed only through POST/DELETE /users/:id/roles, the one path
// that enforces the self-change, last-role and last-SUPER_ADMIN rules (see UserService.update).
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ["roleIds"] as const),
) { }