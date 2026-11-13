import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ADMINISTRATOR_ROLES } from '../../common/security/administrator-roles';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UpdateMyPreferencesDto } from './dto/update-my-preferences.dto';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { SettingsService } from './settings.service';

/**
 * Settings routes. Personal preferences always act on the CALLER's own row (the user id comes from the token, never from the
 * request), so a user can neither read nor change anyone else's — and what they may read or change is decided by the Settings
 * page that owns each value (Regional Preferences, Display Preferences, Notifications), through the same Policy grants as every
 * other permission: VIEW and UPDATE are separate. The route guard asks for ANY of the page grants; SettingsService then checks
 * each page the request really touches. Everything under `system` is `@Roles(SUPER_ADMIN)` — a permission code could be
 * delegated to any role, and these settings (the system defaults and notification switches) are the SUPER_ADMIN's alone, the
 * same rule the SYSTEM attributes already follow. The session timeout and the currency are Attributes: they are managed
 * there, never through these routes. Customer sessions are refused by default (no @CustomerAccessible).
 */
@ApiBearerAuth()
@ApiTags('Settings')
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('preferences')
  @Permission(
    ACTION_CODES.SETTINGS_REGIONAL_VIEW,
    ACTION_CODES.SETTINGS_DISPLAY_VIEW,
    ACTION_CODES.SETTINGS_NOTIFICATIONS_VIEW,
  )
  @ApiOperation({
    summary:
      "The signed-in user's own preferences for the pages they may view (Regional, Display, Notifications), plus the system defaults they fall back to",
  })
  getMyPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getMyPreferences(user);
  }

  @Get('preferences/effective')
  @Authenticated()
  @ApiOperation({
    summary:
      "The values the app applies for the signed-in user (time zone, date format, page size, table density, sidebar state): their own saved choices over the system defaults. Not a Settings page — open to every staff session",
  })
  getMyEffectivePreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getMyEffectivePreferences(user.sub);
  }

  @Patch('preferences')
  @Permission(
    ACTION_CODES.SETTINGS_REGIONAL_UPDATE,
    ACTION_CODES.SETTINGS_DISPLAY_UPDATE,
    ACTION_CODES.SETTINGS_NOTIFICATIONS_UPDATE,
  )
  @ApiOperation({
    summary:
      "Update the signed-in user's own preferences (null clears a choice back to the system default); each field needs the UPDATE grant of the page that owns it",
  })
  updateMyPreferences(@Body() dto: UpdateMyPreferencesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.updateMyPreferences(user, dto);
  }

  @Get('system')
  @Roles(...ADMINISTRATOR_ROLES)
  @ApiOperation({ summary: 'System-wide settings (SUPER_ADMIN only)' })
  getSystemSettings() {
    return this.settings.getSystemSettings();
  }

  @Patch('system')
  @Roles(...ADMINISTRATOR_ROLES)
  @ApiOperation({ summary: 'Update system-wide settings (SUPER_ADMIN only); every changed value is audit-logged' })
  updateSystemSettings(@Body() dto: UpdateSystemSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.updateSystemSettings(dto, user);
  }

  @Get('system/info')
  @Roles(...ADMINISTRATOR_ROLES)
  @ApiOperation({ summary: 'Application information and version (SUPER_ADMIN only) — never secrets or environment variables' })
  getApplicationInfo() {
    return this.settings.getApplicationInfo();
  }
}
