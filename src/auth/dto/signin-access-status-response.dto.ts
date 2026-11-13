import { ApiProperty } from '@nestjs/swagger';

// Backs the Security Credentials tab's "Sign-in access" section. Never exposes the password hash,
// only its presence and last-set time.
export class SigninAccessStatusResponseDto {
  @ApiProperty({ description: 'Whether a usable password is currently set — false after "Disable sign-in access".' })
  signinAccessEnabled!: boolean;

  @ApiProperty({ nullable: true, description: 'When the current password was last set (creation, self-service change, or admin reset). Null if never tracked.' })
  passwordUpdatedAt!: string | null;

  @ApiProperty({
    description:
      'Whether the account is in PROTECTED mode: too many failed sign-ins from too many clients, so only clients that have signed in to it before may still try. ' +
      'One client being locked out of the account is not shown here. Cleared by "Unlock sign-in".',
  })
  signinProtected!: boolean;

  @ApiProperty({ nullable: true, description: 'Seconds until protected mode ends on its own; null when the account is not protected.' })
  signinProtectedRetryAfterSeconds!: number | null;
}
