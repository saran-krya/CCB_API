import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from "@nestjs/swagger";

import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

import {
  IsStrongPassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from "../../../common/validators/strong-password.validator";
import {
  IsMobileNumber,
  IsPersonName,
  Trim,
} from "../../../common/validators/person-fields.validator";

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

  // First and last name share ONE rule with the user's own profile DTO (UpdateOwnProfileDto): trimmed, a real string, not
  // blank, at most 100 characters — see person-fields.validator. The middle name may be blank (it means "none").
  @ApiProperty({
    example: "Fernando",
  })
  @IsPersonName()
  firstName!: string;

  @ApiPropertyOptional({
    example: "A",
  })
  @IsOptional()
  @IsPersonName({ allowBlank: true })
  middleName?: string;

  @ApiProperty({
    example: "Jamil",
  })
  @IsPersonName()
  lastName!: string;

  @ApiPropertyOptional({
    example:
      "Senior Billing Executive",
  })
  @Trim()
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
  @IsMobileNumber()
  mobile?: string;

  @ApiPropertyOptional({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_BYTES,
    description: PASSWORD_POLICY_MESSAGE,
  })
  @IsOptional()
  @IsStrongPassword()
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
  @Trim()
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

// No role field and no password field. Roles are changed only through POST/DELETE /users/:id/roles, the
// one path that enforces the privilege, self-change, last-role and last-SUPER_ADMIN rules; a password is
// changed only through the dedicated change-password / admin-reset flows (which verify the current
// password or the actor's authority, apply the password policy and revoke sessions). With the global
// forbidNonWhitelisted pipe, a request carrying either field is answered with a 400 (see UserService.update).
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ["roleIds", "password"] as const),
) { }