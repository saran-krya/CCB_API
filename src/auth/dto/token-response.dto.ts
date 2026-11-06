import { ApiProperty } from '@nestjs/swagger';
import { TOKEN_TYPE_BEARER } from '../../common/constants/auth.constants';

export class TokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ example: TOKEN_TYPE_BEARER })
  tokenType!: 'Bearer';

  @ApiProperty({ example: '1h', description: 'Access token lifetime' })
  expiresIn!: string;

  @ApiProperty({
    required: false,
    example: 'a3f1...',
    description:
      'Opaque, single-use refresh token. By default it is NOT in the response body: it is delivered only as an ' +
      'HttpOnly cookie, so page scripts can never read it. It is included here only when the server is run ' +
      'with AUTH_REFRESH_IN_BODY=true (for non-browser API clients).',
  })
  refreshToken?: string;

  @ApiProperty({
    example: '7d',
    description:
      'Refresh token lifetime of THIS session: REFRESH_TOKEN_EXPIRES_IN normally, the longer ' +
      'REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN when rememberMe is true.',
  })
  refreshTokenExpiresIn!: string;

  @ApiProperty({
    example: false,
    description:
      'True when this session was signed in with "Remember me": its refresh cookie is persistent (it survives the browser ' +
      'being closed) and its refresh token lives for the longer remembered lifetime. It stays true across every refresh.',
  })
  rememberMe!: boolean;

  @ApiProperty({
    required: false,
    description: 'Staff login/refresh only — true if this account must set a new password before continuing. ' +
      'Absent/false for every other case (customer sessions).',
  })
  mustChangePassword?: boolean;
}
