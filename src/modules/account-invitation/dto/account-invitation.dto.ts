import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { DEFAULT_PAGE, MAX_LIMIT, MIN_LIMIT, MIN_PAGE, SHORT_LIST_DEFAULT_LIMIT } from '../../../common/constants/pagination.constants';
import {
  IsStrongPassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from '../../../common/validators/strong-password.validator';
import { EMAIL_LOCALES } from '../../email-template/email-template.constants';
import { CreateUserDto } from '../../user/dto/create-user.dto';
import { INVITATION_MESSAGE, INVITATION_PRINCIPAL_VALUES, INVITATION_STATUS_VALUES } from '../account-invitation.constants';

/** The shape of a token: 32 random bytes in hex. Anything else cannot be a link we issued, and is refused before the database is asked. */
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export class InvitationQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_PAGE, minimum: MIN_PAGE })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_PAGE)
  @IsOptional()
  page = DEFAULT_PAGE;

  @ApiPropertyOptional({ default: SHORT_LIST_DEFAULT_LIMIT, minimum: MIN_LIMIT, maximum: MAX_LIMIT })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_LIMIT)
  @Max(MAX_LIMIT)
  @IsOptional()
  limit = SHORT_LIST_DEFAULT_LIMIT;

  @ApiPropertyOptional({ enum: INVITATION_PRINCIPAL_VALUES, description: 'Only staff or only customer invitations' })
  @IsOptional()
  @IsIn(INVITATION_PRINCIPAL_VALUES)
  principalType?: 'staff' | 'customer';

  @ApiPropertyOptional({
    minimum: MIN_PAGE,
    description: 'Only the invitation of this account. Use it with principalType: a staff id and a customer id are separate id spaces.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_PAGE)
  @IsOptional()
  principalId?: number;

  @ApiPropertyOptional({ enum: INVITATION_STATUS_VALUES })
  @IsOptional()
  @IsIn(INVITATION_STATUS_VALUES)
  status?: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';

  @ApiPropertyOptional({ description: "Matches the recipient's name or e-mail address" })
  @IsOptional()
  @IsString()
  search?: string;
}

/**
 * A new staff account that is invited rather than given a password: the same details as the Create User form, without a password, a
 * "must change password" flag or an active flag — the account is created inactive with NO password and becomes active only when its owner
 * accepts the invitation. Roles are the ones the signed-in administrator is allowed to grant (the same checks as POST /users).
 */
export class InviteStaffDto extends OmitType(CreateUserDto, ['password', 'active', 'mustChangePassword'] as const) {
  @ApiPropertyOptional({
    enum: EMAIL_LOCALES,
    description: "The language of the invitation e-mail and of the page its link opens. It also becomes the new user's own language. Left out: English.",
  })
  @IsOptional()
  @IsIn(EMAIL_LOCALES)
  language?: 'en' | 'ar';
}

export class ValidateInvitationDto {
  @ApiProperty({ description: 'The raw token from the emailed link' })
  // The raw value, not implicit-conversion text: a number or object must be refused, not turned into a string.
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsString({ message: INVITATION_MESSAGE.INVALID_LINK })
  @Matches(TOKEN_PATTERN, { message: INVITATION_MESSAGE.INVALID_LINK })
  token!: string;
}

export class AcceptInvitationDto extends ValidateInvitationDto {
  // The same password policy as every other credential in the system; this is the person's own first password, chosen on a public route.
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_BYTES, description: PASSWORD_POLICY_MESSAGE })
  @IsStrongPassword()
  password!: string;
}
