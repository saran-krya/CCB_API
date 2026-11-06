import { DATE_FORMATS, isValidTimeZone, SYSTEM_SETTING_DEFAULTS } from '../../modules/attribute/system-setting.rules';

/**
 * The ONE place a date or a number is turned into text for an outbound e-mail. An e-mail has no browser to ask, so the server
 * renders it — and the server's own time zone and locale must never decide what a recipient reads. A date is shown in the
 * RECIPIENT's time zone and date layout (their own Settings > Regional Preferences, else the system defaults) and is laid out
 * exactly as the web app lays it out (CCB_Web lib/utils/date.util.ts: the same DATE_FORMATS, a 24-hour HH:MM); a number is
 * formatted with one fixed locale. Language is not handled here — e-mail templates are English-only today.
 */

/** A recipient's regional choices as stored: their own value, else the system default. A missing or unrecognised value falls
 *  back to the built-in default (SYSTEM_SETTING_DEFAULTS) when formatting, so a stale lookup entry can never break a mail. */
export interface RecipientRegional {
  timeZone: string | null | undefined;
  dateFormat: string | null | undefined;
}

type DateFormat = (typeof DATE_FORMATS)[number];

/** Fixed English month names — the same list the web's DD-MMM-YYYY layout uses, never the server's locale. */
const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The locale every number in an e-mail is formatted with, so the text never depends on the server's own locale. */
const MAIL_NUMBER_LOCALE = 'en-US';

/** What a missing or invalid date shows — the web app's own placeholder. */
const NO_VALUE = '—';

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/** One cached formatter per time zone. The zone must already be known to Intl (isValidTimeZone). */
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function isDateFormat(value: string | null | undefined): value is DateFormat {
  return !!value && (DATE_FORMATS as readonly string[]).includes(value);
}

function layoutDate(year: number, month: number, day: number, format: DateFormat): string {
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  switch (format) {
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${mm}-${dd}`;
    case 'DD-MMM-YYYY':
      return `${dd}-${MONTH_ABBREVIATIONS[month - 1]}-${year}`;
    default:
      return `${dd}/${mm}/${year}`;
  }
}

/**
 * An instant as `<date in the recipient's layout> HH:MM (<time zone>)`, for example `05/11/2026 18:30 (Asia/Dubai)`. The zone's
 * name is appended because an e-mail is read outside the app, where nothing else says which zone the time is in. A null or
 * invalid instant shows as a dash, never a made-up date.
 */
export function formatDateTimeForRecipient(value: Date | null | undefined, regional: RecipientRegional): string {
  if (!value || Number.isNaN(value.getTime())) return NO_VALUE;

  const timeZone = regional.timeZone && isValidTimeZone(regional.timeZone) ? regional.timeZone : SYSTEM_SETTING_DEFAULTS.timezone;
  const format = isDateFormat(regional.dateFormat) ? regional.dateFormat : SYSTEM_SETTING_DEFAULTS.dateFormat;

  const parts = zoneFormatter(timeZone).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  const time = `${String(read('hour')).padStart(2, '0')}:${String(read('minute')).padStart(2, '0')}`;
  return `${layoutDate(read('year'), read('month'), read('day'), format)} ${time} (${timeZone})`;
}

/** A number for an e-mail, always in the fixed locale (en-US grouping and decimal marks) — never `toLocaleString(undefined, …)`,
 *  which would print whatever the server's own locale happens to be. */
export function formatNumberForRecipient(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(MAIL_NUMBER_LOCALE, options);
}
