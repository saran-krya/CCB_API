import { ApiProperty } from '@nestjs/swagger';

export class SessionConfigDto {
  @ApiProperty({ description: 'Minutes of inactivity before the client should force-logout the user' })
  idleTimeoutMinutes!: number;
}
