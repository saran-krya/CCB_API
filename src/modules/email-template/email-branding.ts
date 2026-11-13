/**
 * The look of every managed e-mail, as settings: company name, logo, header colour, primary button colour and footer text. Pure functions only
 * (no database, no Nest): the service reads the stored values and passes them through `resolveBranding`, which is the one place that decides
 * what is safe to put into a message — so a value that was never validated (a row edited on the Attributes screen, a stale one) can still never
 * break a message or put markup into it.
 */

export interface EmailBranding {
  companyName: string;
  /** An https address of the logo image, or null: the header then shows the company's initial and name. */
  logoUrl: string | null;
  /** `#RRGGBB`. The letter on the brand tile is black or white, whichever reads better on this colour — chosen here, never by the administrator. */
  headerColor: string;
  /** `#RRGGBB`. The label on the button is always white, so the colour must be dark enough for it (see MIN_BUTTON_CONTRAST). */
  buttonColor: string;
  /** The administrator's footer sentence for this message's language, or null: the built-in sentence is used. */
  footerText: string | null;
}

/** The brand colour of the header: the tile behind the company's initial and the top edge of the card (the same blue as the default button). */
export const DEFAULT_HEADER_COLOR = '#185FA5';
export const DEFAULT_BUTTON_COLOR = '#185FA5';

export const LOGO_URL_MAX_LENGTH = 500;
export const FOOTER_TEXT_MAX_LENGTH = 500;

/** The button label is white; WCAG AA for normal text asks for 4.5:1 against it. */
export const MIN_BUTTON_CONTRAST = 4.5;

export const BRANDING_MESSAGE = {
  LOGO_INVALID: `The logo must be an https address (at most ${LOGO_URL_MAX_LENGTH} characters) that recipients' mail programs can load`,
  COLOR_INVALID: 'A colour must be written as #RRGGBB, for example #185FA5',
  BUTTON_TOO_LIGHT: 'The button colour is too light for its white label to be readable; choose a darker colour',
} as const;

const WHITE = '#FFFFFF';
const NEAR_BLACK = '#111827';

export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && HEX_COLOR_PATTERN.test(value);

/** `#abc123` → `#ABC123`. Only call it on a value that passed isHexColor. */
export const normalizeHexColor = (value: string): string => value.toUpperCase();

const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const linear = (channel: number): number => {
  const scaled = channel / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a `#RRGGBB` colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG contrast ratio of two `#RRGGBB` colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** White or near-black, whichever is easier to read on `background`. */
export function readableTextColor(background: string): string {
  return contrastRatio(background, WHITE) >= contrastRatio(background, NEAR_BLACK) ? WHITE : NEAR_BLACK;
}

/** Whether the white button label is readable on `color` (a valid `#RRGGBB`). */
export const isReadableButtonColor = (color: string): boolean => contrastRatio(color, WHITE) >= MIN_BUTTON_CONTRAST;

/** `from` moved `ratio` (0..1) of the way towards `to`, as `#RRGGBB` — used for the soft tile behind the initial in the header. */
export function mixColors(from: string, to: string, ratio: number): string {
  const start = channels(from);
  const end = channels(to);
  const mixed = start.map((value, index) => Math.round(value + (end[index] - value) * ratio));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * Whether `value` may be used as the logo address: an https URL of at most LOGO_URL_MAX_LENGTH characters with a host, no user name or
 * password, and none of the characters that could end the `src="…"` attribute it is written into (whitespace, quotes, angle brackets,
 * backslash, control characters). The server never fetches it — recipients' mail programs do.
 */
export function isValidLogoUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > LOGO_URL_MAX_LENGTH) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f"'<>\\`]/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.hostname.length > 0 && url.username === '' && url.password === '';
}

/** The stored settings as they were read: any of them may be missing, empty or (if edited elsewhere) invalid. */
export interface StoredBranding {
  companyName?: string | null;
  logoUrl?: string | null;
  headerColor?: string | null;
  buttonColor?: string | null;
  footerTextEn?: string | null;
  footerTextAr?: string | null;
}

/** The colours that are actually used (a stored colour that is not valid, or a button colour too light for its white label, falls back to the
 *  default) and the logo and footers that survived validation. `footerText` is chosen per message language by `brandingFor`. */
export interface ResolvedBranding {
  companyName: string;
  logoUrl: string | null;
  headerColor: string;
  buttonColor: string;
  footerTextEn: string | null;
  footerTextAr: string | null;
}

const clean = (value: string | null | undefined): string => (typeof value === 'string' ? value.trim() : '');

export function resolveBranding(stored: StoredBranding, defaults: { companyName: string }): ResolvedBranding {
  const header = clean(stored.headerColor);
  const button = clean(stored.buttonColor);
  const logo = clean(stored.logoUrl);
  const footerEn = clean(stored.footerTextEn);
  const footerAr = clean(stored.footerTextAr);
  return {
    companyName: clean(stored.companyName) || defaults.companyName,
    logoUrl: isValidLogoUrl(logo) ? logo : null,
    headerColor: isHexColor(header) ? normalizeHexColor(header) : DEFAULT_HEADER_COLOR,
    buttonColor: isHexColor(button) && isReadableButtonColor(button) ? normalizeHexColor(button) : DEFAULT_BUTTON_COLOR,
    footerTextEn: footerEn.length > 0 && footerEn.length <= FOOTER_TEXT_MAX_LENGTH ? footerEn : null,
    footerTextAr: footerAr.length > 0 && footerAr.length <= FOOTER_TEXT_MAX_LENGTH ? footerAr : null,
  };
}

/** The branding for one message: the resolved settings with the footer of that message's language. */
export function brandingFor(resolved: ResolvedBranding, locale: string): EmailBranding {
  return {
    companyName: resolved.companyName,
    logoUrl: resolved.logoUrl,
    headerColor: resolved.headerColor,
    buttonColor: resolved.buttonColor,
    footerText: locale === 'ar' ? resolved.footerTextAr : resolved.footerTextEn,
  };
}

/** What an administrator's input is refused for, in the order a form shows it; empty when it is fine. An empty optional value always means
 *  "use the default" and is never an error. */
export function validateBrandingInput(input: {
  logoUrl?: string | null;
  headerColor?: string | null;
  buttonColor?: string | null;
}): { logoUrl?: string; headerColor?: string; buttonColor?: string } {
  const problems: { logoUrl?: string; headerColor?: string; buttonColor?: string } = {};
  const logo = clean(input.logoUrl);
  if (logo && !isValidLogoUrl(logo)) problems.logoUrl = BRANDING_MESSAGE.LOGO_INVALID;
  const header = clean(input.headerColor);
  if (header && !isHexColor(header)) problems.headerColor = BRANDING_MESSAGE.COLOR_INVALID;
  const button = clean(input.buttonColor);
  if (button) {
    if (!isHexColor(button)) problems.buttonColor = BRANDING_MESSAGE.COLOR_INVALID;
    else if (!isReadableButtonColor(button)) problems.buttonColor = BRANDING_MESSAGE.BUTTON_TOO_LIGHT;
  }
  return problems;
}
