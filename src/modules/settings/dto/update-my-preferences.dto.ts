import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PAGE_SIZE_OPTIONS, SIDEBAR_STATES, TABLE_DENSITIES } from '../../attribute/system-setting.rules';

export class ChannelPreferenceDto {
  @ApiPropertyOptional()
  @IsBoolean()
  email!: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  inApp!: boolean;
}

export class NotificationPreferencesDto {
  @ApiPropertyOptional({ type: ChannelPreferenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferenceDto)
  approvals?: ChannelPreferenceDto;

  @ApiPropertyOptional({ type: ChannelPreferenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferenceDto)
  billing?: ChannelPreferenceDto;

  @ApiPropertyOptional({ type: ChannelPreferenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferenceDto)
  meterReadings?: ChannelPreferenceDto;

  @ApiPropertyOptional({ type: ChannelPreferenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferenceDto)
  system?: ChannelPreferenceDto;
}

/**
 * The signed-in user's own preferences. A field left out is unchanged; `null` clears the user's choice so the system
 * default applies again. Theme, navigation colour and language are not here — they have their own endpoint
 * (PATCH /users/me/preferences).
 */
export class UpdateMyPreferencesDto {
  @ApiPropertyOptional({ nullable: true, description: 'IANA time zone; must be an active code in the TIMEZONE lookup' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Must be an active code in the DATE_FORMAT lookup' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  dateFormat?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: SIDEBAR_STATES })
  @IsOptional()
  @IsIn(SIDEBAR_STATES)
  sidebarState?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: TABLE_DENSITIES })
  @IsOptional()
  @IsIn(TABLE_DENSITIES)
  tableDensity?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: PAGE_SIZE_OPTIONS })
  @IsOptional()
  @IsInt()
  @IsIn(PAGE_SIZE_OPTIONS)
  defaultPageSize?: number | null;

  @ApiPropertyOptional({ type: NotificationPreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPreferencesDto)
  notifications?: NotificationPreferencesDto;
}
