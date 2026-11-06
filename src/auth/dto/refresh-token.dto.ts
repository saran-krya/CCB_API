import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description:
      'Only for non-browser clients, and only when the server is configured with AUTH_REFRESH_IN_BODY=true. ' +
      'Browsers send the refresh token in the HttpOnly cookie instead and need not send a body at all.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}
