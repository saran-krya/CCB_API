import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import {
  IsStrongPassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from '../../../common/validators/strong-password.validator';

export class ActivateCustomerDto {
  @ApiProperty({ description: 'The raw activation token from the emailed link' })
  // The raw value, not implicit-conversion text: a number or object must be refused, not turned into a string.
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsString()
  token!: string;

  // The same password policy as every other credential in the system (staff creation, change-password,
  // admin reset): this is the customer's own first password, set from a public, unauthenticated route.
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_BYTES, description: PASSWORD_POLICY_MESSAGE })
  @IsStrongPassword()
  password!: string;
}
