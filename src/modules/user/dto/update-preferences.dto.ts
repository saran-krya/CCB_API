import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const THEME_MODES = ['light', 'dark'] as const;
// Mirrors CCB_Web's lib/constants/navThemes.ts NAV_THEMES ids exactly — keep
// in sync if a Navigation theme option is ever added/renamed there ("white"
// was renamed to "default": it has no custom color of its own, it always
// follows the current Light/Dark theme's own sidebar background).
export const NAV_THEMES = ['blue', 'grey', 'amber', 'green', 'default'] as const;

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ enum: THEME_MODES })
  @IsOptional()
  @IsIn(THEME_MODES)
  themeMode?: string;

  @ApiPropertyOptional({ enum: NAV_THEMES })
  @IsOptional()
  @IsIn(NAV_THEMES)
  navTheme?: string;

  // Structural validation only — the actual set of valid codes is the
  // LANGUAGE LOV category (managed via Lookup Field Master), which can grow
  // at runtime with no code change. UserService.updateOwnPreferences()
  // checks this against live LovValue rows, since a DTO decorator can't see
  // the database.
  @ApiPropertyOptional({ description: 'Must be an active code in the LANGUAGE lookup category' })
  @IsOptional()
  @IsString()
  preferredLanguageCode?: string;
}
