import { ApiProperty } from '@nestjs/swagger';

// Backs the Security Credentials tab's "Sign-in access" section. Never exposes the password hash,
// only its presence and last-set time.
export class SigninAccessStatusResponseDto {
  @ApiProperty({ description: 'Whether a usable password is currently set — false after "Disable sign-in access".' })
  signinAccessEnabled!: boolean;

  @ApiProperty({ nullable: true, description: 'When the current password was last set (creation, self-service change, or admin reset). Null if never tracked.' })
  passwordUpdatedAt!: string | null;
}
