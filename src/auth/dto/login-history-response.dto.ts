import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LOGIN_HISTORY_STATUS, LoginHistoryStatus } from '../session.constants';

export class LoginHistoryDto {
  @ApiProperty() id!: number;
  @ApiPropertyOptional() deviceId!: string | null;
  @ApiPropertyOptional() ipAddress!: string | null;
  @ApiPropertyOptional() browser!: string | null;
  @ApiPropertyOptional() platform!: string | null;
  @ApiProperty({ description: 'ISO-8601 login timestamp' }) loginAt!: string;
  @ApiPropertyOptional({ description: 'ISO-8601 logout timestamp; null if the session was never signed out' })
  logoutAt!: string | null;
  @ApiProperty({
    enum: Object.values(LOGIN_HISTORY_STATUS),
    description:
      "'active': still signed in. 'signed_out': signed out, or replaced by a newer sign-in from the same device. " +
      "'expired': never signed out, but no live session is left (it lapsed or was abandoned).",
  })
  status!: LoginHistoryStatus;
}
