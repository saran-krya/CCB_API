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
  @ApiProperty() isTrusted!: boolean;
  @ApiProperty({ description: 'True when this device matches the current request' }) isCurrentDevice!: boolean;
}
