import { ATTRIBUTE_KEY } from './attribute.constants';

/**
 * The SYSTEM attributes OWNED by Settings > System Settings — the application-wide defaults a user's own preference falls
 * back to (language, time zone, date format, page size, table density, sidebar), the installation's primary brand colour, and
 * the two notification switches — and the rules for their values. They are stored as ordinary attributes (one row each: AttributeService gives them the cache, the
 * SUPER_ADMIN rule and the audit trail) but are edited ONLY through PATCH /settings/system, which adds the lookup checks;
 * AttributeService.update refuses them on the generic Attributes route, so there is exactly one place to change each.
 *
 * The reverse also holds: the session timeout, the fixed currency and every business parameter belong to Attributes, are not
 * in this list, and are never written through Settings (which only shows them, read-only, with a link to Attributes).
 *
 * Everything below is a plain function of the value; checks that need the database (the language / time zone / date
 * format must be an active list-of-values entry) stay in SettingsService.
 */

export const SETTINGS_MANAGED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set<string>([
  ATTRIBUTE_KEY.DEFAULT_LANGUAGE,
  ATTRIBUTE_KEY.DEFAULT_TIMEZONE,
  ATTRIBUTE_KEY.DEFAULT_DATE_FORMAT,
  ATTRIBUTE_KEY.DEFAULT_PAGE_SIZE,
  ATTRIBUTE_KEY.DEFAULT_TABLE_DENSITY,
  ATTRIBUTE_KEY.DEFAULT_SIDEBAR_STATE,
  ATTRIBUTE_KEY.BRAND_PRIMARY_COLOR,
  ATTRIBUTE_KEY.NOTIFICATIONS_EMAIL_ENABLED,
  ATTRIBUTE_KEY.NOTIFICATIONS_IN_APP_ENABLED,
]);

/** The date layouts the web app can render (CCB_Web lib/utils/date.util.ts). The DATE_FORMAT lookup lists exactly these. */
export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY'] as const;
export const TABLE_DENSITIES = ['comfortable', 'compact'] as const;
export const SIDEBAR_STATES = ['expanded', 'collapsed'] as const;
/** The rows-per-page choices every paged table offers (CCB_Web lib/constants/list-defaults.ts). */
export const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100] as const;

/** A brand colour is written as six hex digits, `#RRGGBB` (the same shape the e-mail branding colours use). The web app derives
 *  every hover, pressed and light / dark shade from it, so this one value is all that is stored. */
export const BRAND_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** What a freshly installed system starts with — chosen so that nothing changes for existing users: the app already
 *  displayed DD/MM/YYYY, in Dubai time, 10 rows per page, in English, with the sidebar open, in the #0071DF brand blue. */
export const SYSTEM_SETTING_DEFAULTS = {
  language: 'en',
  timezone: 'Asia/Dubai',
  dateFormat: 'DD/MM/YYYY' as (typeof DATE_FORMATS)[number],
  pageSize: 10,
  tableDensity: 'comfortable' as (typeof TABLE_DENSITIES)[number],
  sidebarState: 'expanded' as (typeof SIDEBAR_STATES)[number],
  brandColor: '#0071DF',
} as const;

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const oneOf =
  (label: string, allowed: readonly string[]) =>
  (value: string): string | null =>
    allowed.includes(value) ? null : `${label} must be one of: ${allowed.join(', ')}`;

const RULES: Record<string, (value: string) => string | null> = {
  [ATTRIBUTE_KEY.DEFAULT_TIMEZONE]: (value) =>
    isValidTimeZone(value) ? null : 'Default time zone must be a valid IANA time zone, for example Asia/Dubai',
  [ATTRIBUTE_KEY.DEFAULT_DATE_FORMAT]: oneOf('Default date format', DATE_FORMATS),
  [ATTRIBUTE_KEY.DEFAULT_TABLE_DENSITY]: oneOf('Default table density', TABLE_DENSITIES),
  [ATTRIBUTE_KEY.DEFAULT_SIDEBAR_STATE]: oneOf('Default sidebar state', SIDEBAR_STATES),
  [ATTRIBUTE_KEY.BRAND_PRIMARY_COLOR]: (value) =>
    BRAND_COLOR_PATTERN.test(value) ? null : 'Brand colour must be a hex colour written as #RRGGBB, for example #0071DF',
  [ATTRIBUTE_KEY.DEFAULT_PAGE_SIZE]: (value) =>
    (PAGE_SIZE_OPTIONS as readonly number[]).includes(Number(value))
      ? null
      : `Default page size must be one of: ${PAGE_SIZE_OPTIONS.join(', ')}`,
};

/** The reason `value` is not acceptable for the system setting `key`, or null when it is (or the key has no extra rule). */
export function validateSystemSettingValue(key: string, value: string): string | null {
  return RULES[key]?.(value) ?? null;
}
