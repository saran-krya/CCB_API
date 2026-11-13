import { escapeHtml } from '../../mail/templates/html-escape';
import { DEFAULT_HEADER_COLOR, EmailBranding, isHexColor, readableTextColor } from './email-branding';
import { isRtlLocale } from './email-template.constants';

/** The sentence under the card when the administrator has not written a footer of their own, per language. */
const DEFAULT_FOOTER: Record<string, (company: string) => string> = {
  en: (company) => `This is an automated message from ${company}. Please do not reply to this email.`,
  ar: (company) => `هذه رسالة آلية من ${company}. يرجى عدم الرد على هذا البريد الإلكتروني.`,
};

/** The copyright line under the footer sentence, per language. */
const COPYRIGHT: Record<string, (year: number, company: string) => string> = {
  en: (year, company) => `© ${year} ${company}. All rights reserved.`,
  ar: (year, company) => `© ${year} ${company}. جميع الحقوق محفوظة.`,
};

// Segoe UI / Tahoma cover Latin and Arabic on Windows; the rest are the usual fallbacks on Apple, Android and Linux clients.
const FONT = "'Segoe UI',Tahoma,'Helvetica Neue',Helvetica,Arial,sans-serif";

const PAGE_BACKGROUND = '#F1F4F9';
const CARD_BACKGROUND = '#FFFFFF';
const CARD_BORDER = '#E3E8EF';
const NAME_COLOR = '#111827';
const FOOTER_COLOR = '#64748B';

/** The administrator's footer text as safe HTML: escaped, with line breaks kept as <br>. */
const footerHtml = (text: string): string => escapeHtml(text).replace(/\r?\n/g, '<br />');

/** The first letter of the company name, upper-cased, for the tile shown when there is no logo. */
function initialOf(name: string): string {
  const [first] = Array.from(name.trim());
  return escapeHtml((first ?? '•').toUpperCase());
}


function brandBlock(branding: EmailBranding, rtl: boolean): string {
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const company = escapeHtml(branding.companyName);

  if (branding.logoUrl) {
    return (
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="${dir}" align="${align}" style="border-collapse:collapse;"><tr>` +
      // The alt text carries the name's own colour and type: mail programs block images until the reader allows them, and then the company name
      // (the alt text) must still be readable on the page instead of an empty gap.
      `<td style="vertical-align:middle;"><img src="${escapeHtml(branding.logoUrl)}" alt="${company}" height="36" ` +
      `style="display:block;border:0;outline:none;text-decoration:none;height:36px;width:auto;max-width:220px;color:${NAME_COLOR};font-family:${FONT};font-size:17px;font-weight:700;line-height:36px;" /></td>` +
      `</tr></table>`
    );
  }

  const letterColor = readableTextColor(branding.headerColor);
  const gap = rtl ? 'padding-right:12px;' : 'padding-left:12px;';
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="${dir}" align="${align}" style="border-collapse:collapse;"><tr>` +
    `<td width="36" height="36" align="center" valign="middle" bgcolor="${branding.headerColor}" ` +
    `style="width:36px;height:36px;background-color:${branding.headerColor};border-radius:9px;color:${letterColor};font-family:${FONT};font-size:18px;font-weight:700;line-height:36px;text-align:center;">${initialOf(branding.companyName)}</td>` +
    `<td style="vertical-align:middle;${gap}color:${NAME_COLOR};font-family:${FONT};font-size:16px;font-weight:700;line-height:1.3;">${company}</td>` +
    `</tr></table>`
  );
}

/**
 * The responsive shell around every managed e-mail: the brand block (logo, or the company's initial in a tile and its name) on the page
 * background, a white card with a top edge in the brand colour holding the message, and under it, centred, the footer sentence (the
 * administrator's own, or the built-in one) and the copyright line. An Arabic message is laid out right to left throughout. `bodyHtml` is
 * already complete and already escaped by the caller; every branding value is escaped (or validated as a colour) here.
 *
 * The card is `width:100%; max-width:600px` (the `width="600"` attribute is for Outlook, which ignores max-width). The other way round —
 * `width:600px; max-width:100%` — never shrinks: a percentage max-width inside a shrink-to-fit table cell is circular and is dropped, so on a
 * 390px phone the card stayed 600px wide and the message scrolled sideways (found by rendering the real HTML at phone width).
 */
export function renderEmailLayout(bodyHtml: string, options: { locale: string; branding: EmailBranding; year?: number }): string {
  // The colour goes straight into inline styles, so whatever the caller passed, only a real #RRGGBB can reach them.
  const branding: EmailBranding = {
    ...options.branding,
    headerColor: isHexColor(options.branding.headerColor) ? options.branding.headerColor : DEFAULT_HEADER_COLOR,
  };
  const rtl = isRtlLocale(options.locale);
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const company = escapeHtml(branding.companyName);
  const footer = branding.footerText ? footerHtml(branding.footerText) : (DEFAULT_FOOTER[options.locale] ?? DEFAULT_FOOTER.en)(company);
  const copyright = (COPYRIGHT[options.locale] ?? COPYRIGHT.en)(options.year ?? new Date().getFullYear(), company);

  return `<!doctype html>
<html lang="${escapeHtml(options.locale)}" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${company}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .ccb-outer { padding: 20px 10px 28px !important; }
        .ccb-px { padding-left: 22px !important; padding-right: 22px !important; }
        .ccb-body { padding-top: 30px !important; padding-bottom: 28px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${PAGE_BACKGROUND};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BACKGROUND}" style="background-color:${PAGE_BACKGROUND};">
      <tr>
        <td class="ccb-outer" align="center" style="padding:32px 16px 40px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:100%;max-width:600px;border-collapse:separate;">
            <tr>
              <td style="padding:0 4px 20px;text-align:${align};">
                ${brandBlock(branding, rtl)}
              </td>
            </tr>
            <tr>
              <td class="ccb-px ccb-body" bgcolor="${CARD_BACKGROUND}" style="background-color:${CARD_BACKGROUND};border:1px solid ${CARD_BORDER};border-top:4px solid ${branding.headerColor};border-radius:12px;padding:40px 48px 36px;color:#374151;font-family:${FONT};font-size:15px;line-height:1.65;text-align:${align};">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 16px 0;color:${FOOTER_COLOR};font-family:${FONT};font-size:12px;line-height:1.7;text-align:center;">
                <p style="margin:0;">${footer}</p>
                <p style="margin:0;">${copyright}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
