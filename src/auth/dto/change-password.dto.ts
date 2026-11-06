import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import {
  IsStrongPassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from '../../common/validators/strong-password.validator';

export class ChangePasswordDto {
  @ApiProperty({ description: "The authenticated principal's current password, to confirm identity" })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_BYTES, description: PASSWORD_POLICY_MESSAGE })
  @IsStrongPassword()
  newPassword!: string;
}
