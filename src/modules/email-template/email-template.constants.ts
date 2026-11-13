/** The languages an e-mail template is written in. A template is one row per (key, locale). */
export const EMAIL_LOCALES = ['en', 'ar'] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];
export const DEFAULT_EMAIL_LOCALE: EmailLocale = 'en';

/** Languages written right to left: the message gets `dir="rtl"` and right-aligned text. */
const RTL_LOCALES: ReadonlySet<string> = new Set(['ar']);
export const isRtlLocale = (locale: string): boolean => RTL_LOCALES.has(locale);

/** The templates the invitation system itself sends. They are "system" templates: they always exist (built-in defaults are written on
 *  first start), their key and language cannot be changed, and an inactive or missing one falls back to the built-in default so that
 *  an invitation can never be blocked by an edited or switched-off template. */
export const SYSTEM_TEMPLATE_KEY = {
  STAFF_INVITATION: 'STAFF_INVITATION',
  CUSTOMER_INVITATION: 'CUSTOMER_INVITATION',
  /** The customer's invitation when a Security Deposit is required: the same link, plus the deposit details and what happens next. */
  CUSTOMER_DEPOSIT_INVITATION: 'CUSTOMER_DEPOSIT_INVITATION',
  INVITATION_RESENT: 'INVITATION_RESENT',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  ACCOUNT_ACTIVATED: 'ACCOUNT_ACTIVATED',
} as const;
export type SystemTemplateKey = (typeof SYSTEM_TEMPLATE_KEY)[keyof typeof SYSTEM_TEMPLATE_KEY];
export const SYSTEM_TEMPLATE_KEYS: ReadonlySet<string> = new Set<string>(Object.values(SYSTEM_TEMPLATE_KEY));

/** A template key: upper-case words joined by underscores, 3 to 60 characters. */
export const TEMPLATE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{2,59}$/;

/** The values a template may use as `{{name}}`. Anything else in a template is refused when it is saved. */
export const TEMPLATE_PLACEHOLDER = {
  FIRST_NAME: 'firstName',
  LAST_NAME: 'lastName',
  EMAIL: 'email',
  INVITED_BY: 'invitedBy',
  INVITATION_LINK: 'invitationLink',
  EXPIRY_TIME: 'expiryTime',
  COMPANY_NAME: 'companyName',
  SIGN_IN_LINK: 'signInLink',
  BUTTON_COLOR: 'buttonColor',
  CUSTOMER_REFERENCE: 'customerReference',
  DEPOSIT_AMOUNT: 'depositAmount',
} as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDER)[keyof typeof TEMPLATE_PLACEHOLDER];

/** What each placeholder stands for — shown next to the editor, in the order they are listed. */
export const TEMPLATE_PLACEHOLDER_INFO: ReadonlyArray<{ name: TemplatePlaceholder; description: string }> = [
  { name: TEMPLATE_PLACEHOLDER.FIRST_NAME, description: "The recipient's first name" },
  { name: TEMPLATE_PLACEHOLDER.LAST_NAME, description: "The recipient's last name" },
  { name: TEMPLATE_PLACEHOLDER.EMAIL, description: 'The e-mail address the message is sent to' },
  { name: TEMPLATE_PLACEHOLDER.INVITED_BY, description: 'The name of the administrator who sent the invitation' },
  { name: TEMPLATE_PLACEHOLDER.INVITATION_LINK, description: 'The single-use link that accepts the invitation' },
  { name: TEMPLATE_PLACEHOLDER.EXPIRY_TIME, description: 'When the invitation link stops working, e.g. "in 24 hours (until 12 Nov 2026, 14:35 UTC)"' },
  { name: TEMPLATE_PLACEHOLDER.COMPANY_NAME, description: 'The company name set in Email Templates settings' },
  { name: TEMPLATE_PLACEHOLDER.SIGN_IN_LINK, description: 'The link to the sign-in page (used by the "Account Activated" message)' },
  {
    name: TEMPLATE_PLACEHOLDER.BUTTON_COLOR,
    description: 'The primary button colour from the e-mail settings, for a button cell: bgcolor="{{buttonColor}}"',
  },
  { name: TEMPLATE_PLACEHOLDER.CUSTOMER_REFERENCE, description: "The customer's reference number (the deposit message)" },
  { name: TEMPLATE_PLACEHOLDER.DEPOSIT_AMOUNT, description: 'The Security Deposit amount, e.g. "AED 1,000.00" (the deposit message)' },
];
export const TEMPLATE_PLACEHOLDER_NAMES: ReadonlySet<string> = new Set<string>(Object.values(TEMPLATE_PLACEHOLDER));

export const EMAIL_TEMPLATE_LIMITS = {
  NAME_MAX: 120,
  SUBJECT_MAX: 300,
  BODY_MAX: 100_000,
} as const;

/** The company name shown in the header and footer of every e-mail is a SYSTEM attribute (Platform Settings). The row is created the first time an
 *  administrator saves it — nothing is written to the database before that — and until then the environment variable, then the default, is used. */
export const COMPANY_NAME_ATTRIBUTE_KEY = 'COMPANY_NAME';
export const COMPANY_NAME_ENV_KEY = 'COMPANY_NAME';
export const COMPANY_NAME_MAX_LENGTH = 120;
export const DEFAULT_COMPANY_NAME = 'CCB';

/** How the company-name row looks on the Attributes screen once an administrator has saved it. */
export const COMPANY_NAME_ATTRIBUTE_INFO = {
  label: 'Company name',
  description: 'The company name shown in the header and footer of every e-mail the system sends.',
  displayOrder: 900,
} as const;

/** The rest of the e-mail branding is stored the same way — SYSTEM attributes created the first time an administrator saves them (nothing is
 *  written to the database before that). An empty value means "use the default". The Attributes screen can edit them too, which is why every
 *  stored value is validated again when it is read (email-branding.ts, resolveBranding). */
export const EMAIL_BRANDING_ATTRIBUTE = {
  LOGO_URL: 'EMAIL_LOGO_URL',
  HEADER_COLOR: 'EMAIL_HEADER_COLOR',
  BUTTON_COLOR: 'EMAIL_BUTTON_COLOR',
  FOOTER_TEXT_EN: 'EMAIL_FOOTER_TEXT_EN',
  FOOTER_TEXT_AR: 'EMAIL_FOOTER_TEXT_AR',
} as const;

/** Label, description and position of each branding attribute row, as the Attributes screen shows them. */
export const EMAIL_BRANDING_ATTRIBUTE_INFO: Record<(typeof EMAIL_BRANDING_ATTRIBUTE)[keyof typeof EMAIL_BRANDING_ATTRIBUTE], { label: string; description: string; displayOrder: number }> = {
  EMAIL_LOGO_URL: { label: 'E-mail logo address', description: 'The https address of the logo shown in the header of every e-mail the system sends. Empty: the company name is shown instead.', displayOrder: 901 },
  EMAIL_HEADER_COLOR: { label: 'E-mail header colour', description: 'The header colour of every e-mail, as #RRGGBB. Empty: the default.', displayOrder: 902 },
  EMAIL_BUTTON_COLOR: { label: 'E-mail button colour', description: 'The primary button colour of every e-mail, as #RRGGBB (dark enough for its white label). Empty: the default.', displayOrder: 903 },
  EMAIL_FOOTER_TEXT_EN: { label: 'E-mail footer text (English)', description: 'The footer sentence of English e-mails. Empty: the built-in sentence.', displayOrder: 904 },
  EMAIL_FOOTER_TEXT_AR: { label: 'E-mail footer text (Arabic)', description: 'The footer sentence of Arabic e-mails. Empty: the built-in sentence.', displayOrder: 905 },
};

/** The `module_name` written on audit rows of this module (the Audit Logs screen turns it into "Email Templates"). */
export const EMAIL_TEMPLATE_AUDIT_MODULE = 'email_templates';

export const EMAIL_TEMPLATE_AUDIT_ACTION = {
  CREATED: 'EMAIL_TEMPLATE_CREATED',
  UPDATED: 'EMAIL_TEMPLATE_UPDATED',
  ACTIVATED: 'EMAIL_TEMPLATE_ACTIVATED',
  DEACTIVATED: 'EMAIL_TEMPLATE_DEACTIVATED',
  RESET: 'EMAIL_TEMPLATE_RESET',
  TEST_SENT: 'EMAIL_TEMPLATE_TEST_SENT',
  /** The company name, logo, colours or footer text changed (the audit row lists which). */
  SETTINGS_CHANGED: 'EMAIL_SETTINGS_CHANGED',
} as const;

export const EMAIL_TEMPLATE_MESSAGE = {
  NOT_FOUND: 'Email template not found',
  KEY_TAKEN: 'A template for this key and language already exists',
  KEY_INVALID: 'The key must be upper-case letters, digits and underscores, start with a letter and be 3 to 60 characters long',
  SYSTEM_KEY_LOCKED: 'The key and language of a built-in template cannot be changed',
  NOT_SYSTEM: 'Only a built-in template can be reset to its default',
  NO_DEFAULT: 'There is no built-in default for this template',
  SANITIZER_MISSING:
    'The HTML sanitizer is not installed on the server (npm package "sanitize-html"), so template HTML cannot be saved, previewed or sent as a test until it is.',
  UNKNOWN_PLACEHOLDERS: (names: string[]): string =>
    `Unknown placeholder${names.length === 1 ? '' : 's'}: ${names.map((name) => `{{${name}}}`).join(', ')}`,
  EMPTY_BODY: 'The message body is empty once its HTML has been cleaned',
  NO_ADDRESS: 'Your account has no e-mail address to send the test to',
} as const;
