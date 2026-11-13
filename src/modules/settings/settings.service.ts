import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { loginLockoutLimits } from '../../auth/login-attempts.service';
import { DEFAULT_REFRESH_TOKEN_EXPIRES_IN } from '../../common/constants/auth.constants';
import { ENV_KEY } from '../../common/constants/env.constants';
import { MS_PER_SECOND } from '../../common/constants/time.constants';
import { strictRateLimit } from '../../common/security/throttle-settings';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  REQUIRED_CHARACTER_CLASSES,
} from '../../common/validators/strong-password.validator';
import { durationToMs, resolveAppEnvironment } from '../../config/runtime-config';
import { ATTRIBUTE_KEY } from '../attribute/attribute.constants';
import { AttributeService } from '../attribute/attribute.service';
import { Attribute } from '../attribute/entities/attribute.entity';
import {
  BRAND_COLOR_PATTERN,
  DATE_FORMATS,
  isValidTimeZone,
  SETTINGS_MANAGED_ATTRIBUTE_KEYS,
  SYSTEM_SETTING_DEFAULTS,
  validateSystemSettingValue,
} from '../attribute/system-setting.rules';
import { LOV_CATEGORY } from '../lov/lov.constants';
import { LovService } from '../lov/lov.service';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { UpdateMyPreferencesDto } from './dto/update-my-preferences.dto';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { UserPreference } from './entities/user-preference.entity';
import {
  ApplicationInfoResponse,
  DEFAULT_NOTIFICATION_PREFERENCES,
  EffectivePreferencesResponse,
  MyPreferencesResponse,
  NOTIFICATION_CATEGORIES,
  NotificationPreferences,
  PASSWORD_CHANGE_RULES,
  PREFERENCE_FIELD_SECTION,
  PREFERENCE_SECTIONS,
  PreferenceSection,
  SystemDefaults,
  SystemSettingsResponse,
} from './settings.constants';

/** The attributes Settings owns — the one list lives with their rules (system-setting.rules.ts). */
const SYSTEM_SETTING_KEYS = Array.from(SETTINGS_MANAGED_ATTRIBUTE_KEYS);

const SECTIONS = Object.keys(PREFERENCE_SECTIONS) as PreferenceSection[];

const APPLICATION_NAME = 'CCB';

/** The API's own version from package.json — read once; never anything from the environment beyond NODE_ENV's label. */
const API_VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version ?? 'unknown');
  } catch {
    return process.env.npm_package_version ?? 'unknown';
  }
})();

/**
 * Settings: the signed-in user's own preferences (a row in user_preferences, falling back to system defaults) and the
 * system-wide DEFAULTS those preferences fall back to. The defaults are NOT a table of their own — they are SYSTEM-scope
 * Attributes (SETTINGS_MANAGED_ATTRIBUTE_KEYS), read and written through AttributeService, so the existing validation,
 * SUPER_ADMIN rule, cache invalidation and audit trail all apply and no configuration is stored twice.
 *
 * Ownership: configuration that belongs to Attributes — the session timeout, the fixed currency, the business parameters —
 * is neither written nor re-exposed here (the Settings screens read it from the Attributes API and link to it). Lookups
 * (language, time zone, date format) belong to Lookup Field Master and are only consumed. Nothing here reads or returns
 * secrets or environment variables.
 */
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(UserPreference)
    private readonly prefs: Repository<UserPreference>,
    private readonly attributes: AttributeService,
    private readonly lov: LovService,
    private readonly config: ConfigService,
    private readonly rolePermissions: RolePermissionsService,
  ) {}

  // ───────────────────────────── personal preferences ─────────────────────────────

  /** The caller's own preferences for the Settings pages — only the pages the caller may VIEW. A page without its VIEW grant
   *  contributes nothing (its choices read as "use the system default" and the notification matrix as the defaults), so a
   *  grant for one page never reveals another's values. Always the caller's own row. */
  async getMyPreferences(actor: AuthenticatedUser): Promise<MyPreferencesResponse> {
    const granted = await this.grantedCodes(actor);
    const viewable = new Set(SECTIONS.filter((section) => granted.has(PREFERENCE_SECTIONS[section].view)));
    const [row, systemDefaults] = await Promise.all([this.prefs.findOne({ where: { userId: actor.sub } }), this.getSystemDefaults()]);
    return this.toMyPreferences(row, systemDefaults, viewable);
  }

  /** What the app shell applies everywhere (time zone, date format, page size, table density, sidebar state): the caller's own
   *  saved choices over the system defaults. It is not a Settings page — any signed-in staff session reads it, so system
   *  defaults and choices already saved keep applying whatever Settings pages the role may open; the notification matrix is not
   *  part of it. */
  async getMyEffectivePreferences(userId: number): Promise<EffectivePreferencesResponse> {
    const [row, systemDefaults] = await Promise.all([this.prefs.findOne({ where: { userId } }), this.getSystemDefaults()]);
    return {
      preferences: {
        timezone: row?.timezone ?? null,
        dateFormat: row?.dateFormat ?? null,
        sidebarState: row?.sidebarState ?? null,
        tableDensity: row?.tableDensity ?? null,
        defaultPageSize: row?.defaultPageSize ?? null,
      },
      systemDefaults,
    };
  }

  /** A field left out is unchanged; null clears the choice (the system default applies again). Always the caller's own row.
   *  Every page whose field is in the request needs ITS UPDATE grant (403 otherwise, nothing saved) — the route guard only
   *  checks that the caller holds some preference UPDATE. */
  async updateMyPreferences(actor: AuthenticatedUser, dto: UpdateMyPreferencesDto): Promise<MyPreferencesResponse> {
    await this.assertMayUpdate(actor, dto);
    const userId = actor.sub;
    const row =
      (await this.prefs.findOne({ where: { userId } })) ??
      this.prefs.create({
        userId,
        timezone: null,
        dateFormat: null,
        sidebarState: null,
        tableDensity: null,
        defaultPageSize: null,
        notificationPreferences: null,
      });

    if (dto.timezone !== undefined) row.timezone = dto.timezone === null ? null : await this.validTimeZone(dto.timezone);
    if (dto.dateFormat !== undefined) row.dateFormat = dto.dateFormat === null ? null : await this.validDateFormat(dto.dateFormat);
    if (dto.sidebarState !== undefined) row.sidebarState = dto.sidebarState;
    if (dto.tableDensity !== undefined) row.tableDensity = dto.tableDensity;
    if (dto.defaultPageSize !== undefined) row.defaultPageSize = dto.defaultPageSize;
    if (dto.notifications) {
      // Category by category: only what was sent changes.
      row.notificationPreferences = { ...(row.notificationPreferences ?? {}), ...dto.notifications };
    }

    await this.prefs.save(row);
    return this.getMyPreferences(actor);
  }

  // ───────────────────────────── system settings (SUPER_ADMIN) ─────────────────────────────

  async getSystemSettings(): Promise<SystemSettingsResponse> {
    const values = await this.readSystemValues();
    return {
      general: {
        defaultPageSize: this.number(values, ATTRIBUTE_KEY.DEFAULT_PAGE_SIZE, SYSTEM_SETTING_DEFAULTS.pageSize),
        defaultTableDensity: this.text(values, ATTRIBUTE_KEY.DEFAULT_TABLE_DENSITY, SYSTEM_SETTING_DEFAULTS.tableDensity),
        defaultSidebarState: this.text(values, ATTRIBUTE_KEY.DEFAULT_SIDEBAR_STATE, SYSTEM_SETTING_DEFAULTS.sidebarState),
        brandColor: this.brandColor(values),
      },
      regional: {
        defaultLanguage: this.text(values, ATTRIBUTE_KEY.DEFAULT_LANGUAGE, SYSTEM_SETTING_DEFAULTS.language),
        defaultTimezone: this.text(values, ATTRIBUTE_KEY.DEFAULT_TIMEZONE, SYSTEM_SETTING_DEFAULTS.timezone),
        defaultDateFormat: this.text(values, ATTRIBUTE_KEY.DEFAULT_DATE_FORMAT, SYSTEM_SETTING_DEFAULTS.dateFormat),
      },
      security: this.describeSecurity(),
      notifications: {
        emailEnabled: this.flag(values, ATTRIBUTE_KEY.NOTIFICATIONS_EMAIL_ENABLED),
        inAppEnabled: this.flag(values, ATTRIBUTE_KEY.NOTIFICATIONS_IN_APP_ENABLED),
      },
    };
  }

  /**
   * Every value is validated BEFORE any is written, so a request is never half-applied for a bad field. Each changed value
   * then goes through AttributeService.update — which re-checks SUPER_ADMIN and the type, clears the cache and writes one
   * audit record per setting (module "attributes", old and new value, who). Only the attributes Settings owns are written
   * here; the session timeout and the currency are Attributes and are changed there.
   */
  async updateSystemSettings(dto: UpdateSystemSettingsDto, actor: AuthenticatedUser): Promise<SystemSettingsResponse> {
    const changes: { key: string; value: string }[] = [];
    const set = (key: string, value: string | number | boolean | undefined) => {
      if (value !== undefined) changes.push({ key, value: String(value) });
    };

    set(ATTRIBUTE_KEY.DEFAULT_PAGE_SIZE, dto.general?.defaultPageSize);
    set(ATTRIBUTE_KEY.DEFAULT_TABLE_DENSITY, dto.general?.defaultTableDensity);
    set(ATTRIBUTE_KEY.DEFAULT_SIDEBAR_STATE, dto.general?.defaultSidebarState);
    // Stored in capitals, so "#0071df" and "#0071DF" are one value and an unchanged colour is never rewritten (or audited).
    set(ATTRIBUTE_KEY.BRAND_PRIMARY_COLOR, dto.general?.brandColor?.toUpperCase());
    set(ATTRIBUTE_KEY.DEFAULT_LANGUAGE, dto.regional?.defaultLanguage);
    set(ATTRIBUTE_KEY.DEFAULT_TIMEZONE, dto.regional?.defaultTimezone);
    set(ATTRIBUTE_KEY.DEFAULT_DATE_FORMAT, dto.regional?.defaultDateFormat);
    set(ATTRIBUTE_KEY.NOTIFICATIONS_EMAIL_ENABLED, dto.notifications?.emailEnabled);
    set(ATTRIBUTE_KEY.NOTIFICATIONS_IN_APP_ENABLED, dto.notifications?.inAppEnabled);
    if (!changes.length) return this.getSystemSettings();

    if (dto.regional?.defaultLanguage !== undefined) {
      await this.assertActiveLov(LOV_CATEGORY.LANGUAGE, dto.regional.defaultLanguage, 'language');
    }
    if (dto.regional?.defaultTimezone !== undefined) await this.validTimeZone(dto.regional.defaultTimezone);
    if (dto.regional?.defaultDateFormat !== undefined) await this.validDateFormat(dto.regional.defaultDateFormat);

    const attributes = new Map((await this.attributes.findByKeys(changes.map((change) => change.key))).map((a) => [a.key, a]));
    for (const { key, value } of changes) {
      const attribute = attributes.get(key);
      if (!attribute) throw new NotFoundException(`The setting "${key}" is not configured`);
      const rule = validateSystemSettingValue(key, value);
      if (rule) throw new BadRequestException(rule);
    }

    for (const { key, value } of changes) {
      const attribute = attributes.get(key)!;
      if (attribute.value === value) continue;
      await this.attributes.update(attribute.id, { value }, actor.sub, actor.roleNames, actor.roleIds, true);
    }
    return this.getSystemSettings();
  }

  /** Application information and version — a fixed, non-sensitive set (never environment variables or secrets). */
  getApplicationInfo(): ApplicationInfoResponse {
    return {
      applicationName: APPLICATION_NAME,
      apiVersion: API_VERSION,
      environment: resolveAppEnvironment(process.env.NODE_ENV),
      nodeVersion: process.version,
      serverTime: new Date().toISOString(),
      serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  /** The system-wide defaults a user's own preferences fall back to, read exactly as the Settings screens show them. Public so
   *  NotificationPolicyService (the notification channel switches, and the default time zone and date format used to render
   *  mail content) answers from the same reading instead of keeping a second reader of these attributes. */
  async getSystemDefaults(): Promise<SystemDefaults> {
    const values = await this.readSystemValues();
    return {
      language: this.text(values, ATTRIBUTE_KEY.DEFAULT_LANGUAGE, SYSTEM_SETTING_DEFAULTS.language),
      timezone: this.text(values, ATTRIBUTE_KEY.DEFAULT_TIMEZONE, SYSTEM_SETTING_DEFAULTS.timezone),
      dateFormat: this.text(values, ATTRIBUTE_KEY.DEFAULT_DATE_FORMAT, SYSTEM_SETTING_DEFAULTS.dateFormat),
      pageSize: this.number(values, ATTRIBUTE_KEY.DEFAULT_PAGE_SIZE, SYSTEM_SETTING_DEFAULTS.pageSize),
      tableDensity: this.text(values, ATTRIBUTE_KEY.DEFAULT_TABLE_DENSITY, SYSTEM_SETTING_DEFAULTS.tableDensity),
      sidebarState: this.text(values, ATTRIBUTE_KEY.DEFAULT_SIDEBAR_STATE, SYSTEM_SETTING_DEFAULTS.sidebarState),
      brandColor: this.brandColor(values),
      notifications: {
        emailEnabled: this.flag(values, ATTRIBUTE_KEY.NOTIFICATIONS_EMAIL_ENABLED),
        inAppEnabled: this.flag(values, ATTRIBUTE_KEY.NOTIFICATIONS_IN_APP_ENABLED),
      },
    };
  }

  /** `visible` lists the pages whose stored values may be returned; every other page's values come back as if never set. */
  private toMyPreferences(row: UserPreference | null, systemDefaults: SystemDefaults, visible: ReadonlySet<PreferenceSection>): MyPreferencesResponse {
    const stored = visible.has('notifications') ? (row?.notificationPreferences ?? {}) : {};
    const notifications = {} as NotificationPreferences;
    for (const category of NOTIFICATION_CATEGORIES) {
      notifications[category] = { ...DEFAULT_NOTIFICATION_PREFERENCES[category], ...(stored[category] ?? {}) };
    }
    const regional = visible.has('regional') ? row : null;
    const display = visible.has('display') ? row : null;
    return {
      preferences: {
        timezone: regional?.timezone ?? null,
        dateFormat: regional?.dateFormat ?? null,
        sidebarState: display?.sidebarState ?? null,
        tableDensity: display?.tableDensity ?? null,
        defaultPageSize: display?.defaultPageSize ?? null,
        notifications,
      },
      systemDefaults,
    };
  }

  /** The Action codes the caller holds right now (live roles plus their own inline policies), read once per request. */
  private async grantedCodes(actor: AuthenticatedUser): Promise<Set<string>> {
    return new Set(await this.rolePermissions.getMyActionCodesForRoles(actor.roleIds ?? [actor.roleId], actor.sub));
  }

  /** 403 unless the caller holds the UPDATE grant of every page that owns a field in `dto`. */
  private async assertMayUpdate(actor: AuthenticatedUser, dto: UpdateMyPreferencesDto): Promise<void> {
    const touched = new Set<PreferenceSection>();
    for (const [field, section] of Object.entries(PREFERENCE_FIELD_SECTION) as [keyof typeof PREFERENCE_FIELD_SECTION, PreferenceSection][]) {
      if (dto[field] !== undefined) touched.add(section);
    }
    if (touched.size === 0) return;

    const granted = await this.grantedCodes(actor);
    const missing = [...touched].filter((section) => !granted.has(PREFERENCE_SECTIONS[section].update));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `You do not have permission to change ${missing.map((section) => PREFERENCE_SECTIONS[section].name).join(', ')}. ` +
          `Required permission: ${missing.map((section) => PREFERENCE_SECTIONS[section].update).join(', ')}.`,
      );
    }
  }

  private async readSystemValues(): Promise<Map<string, Attribute>> {
    return new Map((await this.attributes.findByKeys(SYSTEM_SETTING_KEYS)).map((attribute) => [attribute.key, attribute]));
  }

  private text(values: Map<string, Attribute>, key: string, fallback: string): string {
    return values.get(key)?.value ?? fallback;
  }

  /** The brand colour as `#RRGGBB` in capitals; the built-in blue when the row is missing or holds anything else (a hand-edited
   *  value must never reach the web app's stylesheet). */
  private brandColor(values: Map<string, Attribute>): string {
    const stored = values.get(ATTRIBUTE_KEY.BRAND_PRIMARY_COLOR)?.value?.trim();
    return stored && BRAND_COLOR_PATTERN.test(stored) ? stored.toUpperCase() : SYSTEM_SETTING_DEFAULTS.brandColor;
  }

  private number(values: Map<string, Attribute>, key: string, fallback: number): number {
    const parsed = Number(values.get(key)?.value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private flag(values: Map<string, Attribute>, key: string): boolean {
    return (values.get(key)?.value ?? 'true') === 'true';
  }

  /** What the system enforces on passwords and sign-in, reported read-only. Every number comes from the code that enforces it —
   *  the password validator, the sign-in lock-out and the strict request limit, each of which resolves its own environment
   *  settings — never from a copy kept here, so this screen cannot drift from the real rule. */
  private describeSecurity(): SystemSettingsResponse['security'] {
    const lockout = loginLockoutLimits();
    const rateLimit = strictRateLimit().default;
    const refreshTokenLifetime = this.config.get<string>(ENV_KEY.REFRESH_TOKEN_EXPIRES_IN, DEFAULT_REFRESH_TOKEN_EXPIRES_IN);
    return {
      passwordPolicy: {
        minLength: PASSWORD_MIN_LENGTH,
        maxLength: PASSWORD_MAX_LENGTH,
        requirement: PASSWORD_POLICY_MESSAGE,
        maxBytes: PASSWORD_MAX_BYTES,
        requiredCharacterClasses: REQUIRED_CHARACTER_CLASSES,
        ...PASSWORD_CHANGE_RULES,
        lockout: { maxFailedPerAccount: lockout.perAccount, maxFailedPerIp: lockout.perIp, windowSeconds: lockout.windowSeconds },
        signInRateLimit: { limit: rateLimit.limit(), windowSeconds: Math.round(rateLimit.ttl() / MS_PER_SECOND) },
      },
      refreshTokenLifetime,
      refreshTokenLifetimeSeconds: this.secondsOf(refreshTokenLifetime),
    };
  }

  /** A duration written "30s" / "15m" / "1h" / "7d", in whole seconds; null when it is not in that format. */
  private secondsOf(duration: string): number | null {
    try {
      return Math.round(durationToMs(duration) / MS_PER_SECOND);
    } catch {
      return null;
    }
  }

  /** The code must be an ACTIVE entry of the lookup category — the same rule a user's preferred language already follows. */
  private async assertActiveLov(category: string, code: string, label: string): Promise<string> {
    const values = await this.lov.findByCategory(category);
    if (!values.some((value) => value.code === code)) {
      throw new BadRequestException(`"${code}" is not an active ${label} — configure it in Lookup Field Master first`);
    }
    return code;
  }

  private async validTimeZone(code: string): Promise<string> {
    await this.assertActiveLov(LOV_CATEGORY.TIMEZONE, code, 'time zone');
    if (!isValidTimeZone(code)) throw new BadRequestException(`"${code}" is not a valid IANA time zone`);
    return code;
  }

  private async validDateFormat(code: string): Promise<string> {
    await this.assertActiveLov(LOV_CATEGORY.DATE_FORMAT, code, 'date format');
    if (!(DATE_FORMATS as readonly string[]).includes(code)) throw new BadRequestException(`"${code}" is not a supported date format`);
    return code;
  }
}
