import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class DisableSigninAccessDto {
  @ApiPropertyOptional({
    default: false,
    description: "Also revoke every active session/device for this user (same effect as 'Revoke active sign-in sessions').",
  })
  @IsOptional()
  @IsBoolean()
  revokeSessions?: boolean;
}
