/** The recipient's address with its middle hidden (`s***a@example.com`) — for answers and logs that must not repeat a full address. */
export function maskEmailAddress(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || !local) return '***';
  const maskedLocal = local.length <= 2 ? '*'.repeat(local.length) : `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${maskedLocal}@${domain}`;
}

/** `"in 24 hours"` / `"خلال 24 ساعة"` — how long a link works, for text that says when it stops. */
export function describeLifetime(hours: number, locale: string): string {
  if (locale === 'ar') return `خلال ${hours} ساعة`;
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * The `{{expiryTime}}` text: the lifetime and the moment it ends, in UTC so it means the same to everybody ("in 24 hours (until 12 Nov 2026,
 * 14:35 UTC)"). Arabic uses the UAE locale, which writes Latin digits like the rest of the product.
 */
export function formatExpiryTime(expiresAt: Date, hours: number, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  const moment = `${formatter.format(expiresAt)} UTC`;
  return locale === 'ar' ? `${describeLifetime(hours, locale)} (حتى ${moment})` : `${describeLifetime(hours, locale)} (until ${moment})`;
}

/** The template language for a stored language preference: 'ar' / 'Arabic' → Arabic, anything else (or nothing) → English. */
export function emailLocaleOf(preference: string | null | undefined): 'en' | 'ar' {
  return typeof preference === 'string' && preference.trim().toLowerCase().startsWith('ar') ? 'ar' : 'en';
}
