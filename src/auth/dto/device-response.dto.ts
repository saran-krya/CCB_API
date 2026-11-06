import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserDeviceDto {
  @ApiProperty() id!: number;
  @ApiProperty() deviceId!: string;
  @ApiPropertyOptional() deviceName!: string | null;
  @ApiPropertyOptional() deviceType!: string | null;
  @ApiPropertyOptional() browser!: string | null;
  @ApiPropertyOptional() browserVersion!: string | null;
  @ApiPropertyOptional() operatingSystem!: string | null;
  @ApiPropertyOptional() osVersion!: string | null;
  @ApiPropertyOptional() ipAddress!: string | null;
  @ApiProperty({ description: 'ISO-8601' }) lastLoginAt!: string | null;
  @ApiProperty({ description: 'ISO-8601' }) lastActivityAt!: string | null;
  @ApiProperty({ description: 'ISO-8601. When this session can no longer be refreshed (renewed with every refresh); null if the device row carries none.' })
  expiresAt!: string | null;
  @ApiProperty({ description: 'True when the session was signed in with "Remember me" (a persistent session with the longer lifetime).' })
  rememberMe!: boolean;
  @ApiProperty() isTrusted!: boolean;
  @ApiProperty({ description: 'True when this device holds the session that made the request (from the access token, never from a header)' }) isCurrentDevice!: boolean;
}
