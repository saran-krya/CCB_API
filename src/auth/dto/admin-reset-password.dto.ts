import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import {
  IsStrongPassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from '../../common/validators/strong-password.validator';

export class AdminResetPasswordDto {
  // Omitted (or absent) => autogenerate a secure random password server-side, returned once in the
  // response (same "shown once, never persisted in plaintext, never retrievable again" contract as
  // the existing Create User wizard's own "Retrieve password" step for a brand-new user).
  @ApiPropertyOptional({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_BYTES,
    description:
      'A specific new password to set. Omit to auto-generate one server-side. When provided it must meet ' +
      `the password policy: ${PASSWORD_POLICY_MESSAGE}`,
  })
  @IsOptional()
  @IsStrongPassword()
  newPassword?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      "Force this user to set their own new password the next time they sign in. Defaults to true, because " +
      'the administrator knows the password they just set.',
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
