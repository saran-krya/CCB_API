import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

// The "Manage sign-in access -> Reset password" complexity rule (min 8 chars, at least three of
// the four character classes) — no equivalent validator exists anywhere else in this codebase
// (CreateUserDto.password/ChangePasswordDto.newPassword are min-length-8 only), so this is
// intentionally its own rule, scoped to this admin-reset dialog only. Not applied retroactively to
// the existing Create/Edit User password fields, which are out of scope for this feature.
const CHARACTER_CLASSES = [/[A-Z]/, /[a-z]/, /[0-9]/, /[!@#$%^&*()_+\-[\]{}|']/];

@ValidatorConstraint({ name: 'passwordComplexity', async: false })
class PasswordComplexityConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const classesPresent = CHARACTER_CLASSES.filter((re) => re.test(value)).length;
    return classesPresent >= 3;
  }

  defaultMessage(): string {
    return 'Password must include at least 3 of the following: uppercase letters, lowercase letters, numbers, symbols';
  }
}

export class AdminResetPasswordDto {
  // Omitted (or absent) => autogenerate a secure random password server-side, returned once in the
  // response (same "shown once, never persisted in plaintext, never retrievable again" contract as
  // the existing Create User wizard's own "Retrieve password" step for a brand-new user).
  @ApiPropertyOptional({
    minLength: 8,
    description:
      'A specific new password to set. Omit to auto-generate one server-side. When provided, must be ' +
      'at least 8 characters and include at least 3 of: uppercase, lowercase, digit, symbol.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @Validate(PasswordComplexityConstraint)
  newPassword?: string;

  @ApiPropertyOptional({
    default: false,
    description: "Force this user to set their own new password the next time they sign in.",
  })
  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: "Also revoke every active session/device for this user (same effect as 'Revoke active sign-in sessions').",
  })
  @IsOptional()
  @IsBoolean()
  revokeSessions?: boolean;
}
