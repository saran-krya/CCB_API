import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'The "Remember me" choice. true: a persistent session — the refresh cookie survives the browser being closed and the ' +
      'refresh token lives for REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN. false or absent: a browser-session cookie and the normal ' +
      'REFRESH_TOKEN_EXPIRES_IN lifetime. The access token is the same either way.',
  })
  @IsOptional()
  // The global ValidationPipe runs with implicit conversion, which would turn the text "false" (or "yes", or the number 1)
  // into the boolean true BEFORE @IsBoolean looks at it — and a persistent 30-day session is not something a mistyped
  // value should hand out. So the value the client really sent (obj[key]) is what gets validated: only a JSON true / false
  // passes, anything else is a 400 (same approach as trimString and IsStrongPassword).
  @Transform(({ obj, key }: TransformFnParams) => (obj as Record<string, unknown>)[key], { toClassOnly: true })
  @IsBoolean()
  rememberMe?: boolean;
}
