import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginHistoryDto {
  @ApiProperty() id!: number;
  @ApiPropertyOptional() deviceId!: string | null;
  @ApiPropertyOptional() ipAddress!: string | null;
  @ApiPropertyOptional() browser!: string | null;
  @ApiPropertyOptional() platform!: string | null;
  @ApiProperty({ description: 'ISO-8601 login timestamp' }) loginAt!: string;
  @ApiPropertyOptional({ description: 'ISO-8601 logout timestamp; null if session is still active' })
  logoutAt!: string | null;
}
