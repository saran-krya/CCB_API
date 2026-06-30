import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ example: '1h', description: 'Access token lifetime' })
  expiresIn!: string;

  @ApiProperty({ example: 'a3f1...', description: 'Opaque refresh token — store securely, single-use' })
  refreshToken!: string;

  @ApiProperty({ example: '7d', description: 'Refresh token lifetime' })
  refreshTokenExpiresIn!: string;
}