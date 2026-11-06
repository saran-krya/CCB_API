import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PAGE_SIZE_OPTIONS, SIDEBAR_STATES, TABLE_DENSITIES } from '../../attribute/system-setting.rules';

export class GeneralSettingsDto {
  @ApiPropertyOptional({ enum: PAGE_SIZE_OPTIONS })
  @IsOptional()
  @IsInt()
  @IsIn(PAGE_SIZE_OPTIONS)
  defaultPageSize?: number;

  @ApiPropertyOptional({ enum: TABLE_DENSITIES })
  @IsOptional()
  @IsIn(TABLE_DENSITIES)
  defaultTableDensity?: string;

  @ApiPropertyOptional({ enum: SIDEBAR_STATES })
  @IsOptional()
  @IsIn(SIDEBAR_STATES)
  defaultSidebarState?: string;
}

export class RegionalSettingsDto {
  @ApiPropertyOptional({ description: 'Must be an active code in the LANGUAGE lookup' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultLanguage?: string;

  @ApiPropertyOptional({ description: 'Must be an active code in the TIMEZONE lookup' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  defaultTimezone?: string;

  @ApiPropertyOptional({ description: 'Must be an active code in the DATE_FORMAT lookup' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  defaultDateFormat?: string;
}

export class NotificationSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;
}

/** The system-wide defaults Settings owns (SUPER_ADMIN only). A section or field left out is unchanged. The session
 *  timeout and the currency are Attributes and are not part of this payload. */
export class UpdateSystemSettingsDto {
  @ApiPropertyOptional({ type: GeneralSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeneralSettingsDto)
  general?: GeneralSettingsDto;

  @ApiPropertyOptional({ type: RegionalSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RegionalSettingsDto)
  regional?: RegionalSettingsDto;

  @ApiPropertyOptional({ type: NotificationSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationSettingsDto)
  notifications?: NotificationSettingsDto;
}
