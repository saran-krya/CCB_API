import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const THEME_MODES = ['light', 'dark'] as const;
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

  @ApiPropertyOptional({ description: 'Must be an active code in the LANGUAGE lookup category' })
  @IsOptional()
  @IsString()
  preferredLanguageCode?: string;
}
