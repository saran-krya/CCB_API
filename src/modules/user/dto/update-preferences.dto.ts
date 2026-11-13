import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const THEME_MODES = ['light', 'dark'] as const;
export const NAV_THEMES = ['blue', 'dark', 'grey', 'amber', 'green', 'default'] as const;

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ enum: THEME_MODES })
  @IsOptional()
  @IsIn(THEME_MODES)
  themeMode?: string;

  @ApiPropertyOptional({ enum: NAV_THEMES })
  @IsOptional()
  @IsIn(NAV_THEMES)
  navTheme?: string;

  // Left out = unchanged. `null` clears the personal choice, so the system default language (DEFAULT_LANGUAGE) applies again;
  // anything else must be an active code of the LANGUAGE lookup (checked by UserService.updateOwnPreferences).
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Must be an active code in the LANGUAGE lookup category. null clears the personal choice, so the system default language applies again.',
  })
  @IsOptional()
  @IsString()
  preferredLanguageCode?: string | null;
}
