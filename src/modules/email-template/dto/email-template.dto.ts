import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/validators/person-fields.validator';
import { FOOTER_TEXT_MAX_LENGTH, LOGO_URL_MAX_LENGTH } from '../email-branding';
import {
  COMPANY_NAME_MAX_LENGTH,
  EMAIL_LOCALES,
  EMAIL_TEMPLATE_LIMITS,
  EMAIL_TEMPLATE_MESSAGE,
  TEMPLATE_KEY_PATTERN,
} from '../email-template.constants';

export class EmailTemplateQueryDto {
  @ApiPropertyOptional({ enum: EMAIL_LOCALES })
  @IsOptional()
  @IsIn(EMAIL_LOCALES)
  locale?: string;

  @ApiPropertyOptional({ description: 'Only the template with this key (every language of it)' })
  @IsOptional()
  @IsString()
  key?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Only active or only inactive templates' })
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';

  @ApiPropertyOptional({ description: 'Matches the template name, key or subject' })
  @IsOptional()
  @IsString()
  search?: string;
}

/** The content of a message, shared by preview and test-send (the editor sends what is on screen, saved or not). */
export class EmailContentDto {
  @ApiProperty({ enum: EMAIL_LOCALES })
  @IsIn(EMAIL_LOCALES)
  locale!: string;

  @ApiProperty({ maxLength: EMAIL_TEMPLATE_LIMITS.SUBJECT_MAX })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EMAIL_TEMPLATE_LIMITS.SUBJECT_MAX)
  subject!: string;

  @ApiProperty({ description: 'The message body as an HTML fragment, with {{placeholders}}', maxLength: EMAIL_TEMPLATE_LIMITS.BODY_MAX })
  @IsString()
  @IsNotEmpty()
  @MaxLength(EMAIL_TEMPLATE_LIMITS.BODY_MAX)
  bodyHtml!: string;

  @ApiPropertyOptional({ description: 'The plain-text version; left out or null means "make it from the HTML"', maxLength: EMAIL_TEMPLATE_LIMITS.BODY_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(EMAIL_TEMPLATE_LIMITS.BODY_MAX)
  bodyText?: string | null;
}

export class CreateEmailTemplateDto extends EmailContentDto {
  @ApiProperty({ example: 'PAYMENT_REMINDER' })
  @Trim()
  @IsString()
  @Matches(TEMPLATE_KEY_PATTERN, { message: EMAIL_TEMPLATE_MESSAGE.KEY_INVALID })
  key!: string;

  @ApiProperty({ maxLength: EMAIL_TEMPLATE_LIMITS.NAME_MAX })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EMAIL_TEMPLATE_LIMITS.NAME_MAX)
  name!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Key and language are not editable — a template is changed in place, never renamed. */
export class UpdateEmailTemplateDto {
  @ApiPropertyOptional({ maxLength: EMAIL_TEMPLATE_LIMITS.NAME_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EMAIL_TEMPLATE_LIMITS.NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ maxLength: EMAIL_TEMPLATE_LIMITS.SUBJECT_MAX })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EMAIL_TEMPLATE_LIMITS.SUBJECT_MAX)
  subject?: string;

  @ApiPropertyOptional({ maxLength: EMAIL_TEMPLATE_LIMITS.BODY_MAX })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EMAIL_TEMPLATE_LIMITS.BODY_MAX)
  bodyHtml?: string;

  @ApiPropertyOptional({ description: 'null clears it ("make it from the HTML")', maxLength: EMAIL_TEMPLATE_LIMITS.BODY_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(EMAIL_TEMPLATE_LIMITS.BODY_MAX)
  bodyText?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetEmailTemplateActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

/**
 * The e-mail branding. For every optional setting: left out = unchanged; an empty string or null = back to the default. The format rules
 * (an https logo address, #RRGGBB colours, a button colour dark enough for its white label) are applied by the service, which answers 400
 * with one message per field.
 */
export class UpdateEmailSettingsDto {
  @ApiProperty({ maxLength: COMPANY_NAME_MAX_LENGTH, description: 'The company name shown in the header and footer of every e-mail' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMPANY_NAME_MAX_LENGTH)
  companyName!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: LOGO_URL_MAX_LENGTH, description: 'The https address of the logo shown in the e-mail header' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(LOGO_URL_MAX_LENGTH)
  logoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '#1F2937', description: 'The header colour, as #RRGGBB' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(7)
  headerColor?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '#185FA5', description: 'The primary button colour, as #RRGGBB (dark enough for a white label)' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(7)
  buttonColor?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: FOOTER_TEXT_MAX_LENGTH, description: 'The footer sentence of English e-mails' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(FOOTER_TEXT_MAX_LENGTH)
  footerTextEn?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: FOOTER_TEXT_MAX_LENGTH, description: 'The footer sentence of Arabic e-mails' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(FOOTER_TEXT_MAX_LENGTH)
  footerTextAr?: string | null;
}
