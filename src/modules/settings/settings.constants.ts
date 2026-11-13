import { ACTION_CODES } from '../../common/constants/action-codes.constants';

/**
 * The Settings pages that share GET/PATCH /settings/preferences, and the grants each one needs. A preference belongs to exactly
 * one page, so the page's own VIEW decides whether its values are returned and its own UPDATE whether they may be changed —
 * VIEW and UPDATE are independent (Appearance has its own route, PATCH /users/me/preferences, and its own grant).
 */
export const PREFERENCE_SECTIONS = {
  regional: { name: 'Regional Preferences', view: ACTION_CODES.SETTINGS_REGIONAL_VIEW, update: ACTION_CODES.SETTINGS_REGIONAL_UPDATE },
  display: { name: 'Display Preferences', view: ACTION_CODES.SETTINGS_DISPLAY_VIEW, update: ACTION_CODES.SETTINGS_DISPLAY_UPDATE },
  notifications: { name: 'Notifications', view: ACTION_CODES.SETTINGS_NOTIFICATIONS_VIEW, update: ACTION_CODES.SETTINGS_NOTIFICATIONS_UPDATE },
} as const;
export type PreferenceSection = keyof typeof PREFERENCE_SECTIONS;

/** Which page owns each field of UpdateMyPreferencesDto. */
export const PREFERENCE_FIELD_SECTION = {
  timezone: 'regional',
  dateFormat: 'regional',
  sidebarState: 'display',
  tableDensity: 'display',
  defaultPageSize: 'display',
  notifications: 'notifications',
} as const satisfies Record<string, PreferenceSection>;

/** The notification categories a user can switch per channel (Settings > Notifications). A category is a feature area, not
 *  configurable data, so it is a fixed list here; the labels live in the web app's translations. */
export const NOTIFICATION_CATEGORIES = ['approvals', 'billing', 'meterReadings', 'system'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface ChannelPreference {
  email: boolean;
  inApp: boolean;
}

export type NotificationPreferences = Record<NotificationCategory, ChannelPreference>;

/** Every category on, on both channels, until the user switches something off. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  approvals: { email: true, inApp: true },
  billing: { email: true, inApp: true },
  meterReadings: { email: true, inApp: true },
  system: { email: true, inApp: true },
};

/** The system-wide values a user's own preferences fall back to (the SYSTEM attributes behind System Settings). */
export interface SystemDefaults {
  language: string;
  timezone: string;
  dateFormat: string;
  pageSize: number;
  tableDensity: string;
  sidebarState: string;
  /** The primary brand colour, `#RRGGBB` — an installation-wide value (no user chooses their own), delivered with the defaults so
   *  the app shell can theme itself from the same response that carries the rest. */
  brandColor: string;
  notifications: { emailEnabled: boolean; inAppEnabled: boolean };
}

/** A user's own stored choices; null means "use the system default". */
export interface StoredPreferences {
  timezone: string | null;
  dateFormat: string | null;
  sidebarState: string | null;
  tableDensity: string | null;
  defaultPageSize: number | null;
  notifications: NotificationPreferences;
}

export interface MyPreferencesResponse {
  preferences: StoredPreferences;
  systemDefaults: SystemDefaults;
}

/** What the app shell needs to APPLY a user's choices everywhere (time zone, date format, page size, density, sidebar) —
 *  never the notification matrix, which only the Notifications page reads. */
export interface EffectivePreferencesResponse {
  preferences: Omit<StoredPreferences, 'notifications'>;
  systemDefaults: SystemDefaults;
}

/** What a password change always does (AuthService.changePassword): the new password must differ from the current one, and
 *  every other signed-in device is signed out. Fixed in code, so reported as facts by GET /settings/system, never as settings. */
export const PASSWORD_CHANGE_RULES = { mustDifferFromCurrent: true, revokesOtherSessions: true } as const;

export interface SystemSettingsResponse {
  general: { defaultPageSize: number; defaultTableDensity: string; defaultSidebarState: string; brandColor: string };
  regional: { defaultLanguage: string; defaultTimezone: string; defaultDateFormat: string };
  security: {
    /** Read-only: enforced in code (and deployment configuration), not configurable here. */
    passwordPolicy: {
      minLength: number;
      /** The same number as `maxBytes`, kept so existing readers keep working: the upper limit is counted in UTF-8 bytes. */
      maxLength: number;
      /** The API's own English sentence for the rule. */
      requirement: string;
      maxBytes: number;
      /** How many of the four character types a password must contain. */
      requiredCharacterClasses: number;
      /** A new password must differ from the current one (checked on a password change). */
      mustDifferFromCurrent: boolean;
      /** A password change signs every other device out. */
      revokesOtherSessions: boolean;
      /** Failed sign-ins are counted per account and per client IP in one fixed window; reaching either count blocks sign-in until it ends. */
      lockout: { maxFailedPerAccount: number; maxFailedPerIp: number; windowSeconds: number };
      /** The strict per-IP request limit on sign-in, token refresh, activation, password change and administrator credential actions. */
      signInRateLimit: { limit: number; windowSeconds: number };
    };
    /** Read-only: how long a sign-in stays refreshable, as configured (REFRESH_TOKEN_EXPIRES_IN, e.g. "7d"). */
    refreshTokenLifetime: string;
    /** The same lifetime in seconds; null when the configured value is not in the "30s" / "15m" / "1h" / "7d" format. */
    refreshTokenLifetimeSeconds: number | null;
  };
  notifications: { emailEnabled: boolean; inAppEnabled: boolean };
}

export interface ApplicationInfoResponse {
  applicationName: string;
  apiVersion: string;
  environment: string;
  nodeVersion: string;
  serverTime: string;
  serverTimeZone: string;
  uptimeSeconds: number;
}
