import { escapeHtml } from '../../mail/templates/html-escape';
import { EmailBranding } from './email-branding';
import { renderEmailLayout } from './email-layout';
import { TEMPLATE_PLACEHOLDER_NAMES } from './email-template.constants';

/** The values a message is filled with, by placeholder name. A missing value renders as nothing. */
export type TemplateValues = Readonly<Record<string, string | undefined>>;

export interface RenderableTemplate {
  subject: string;
  bodyHtml: string;
  /** The plain-text alternative. When it is empty it is made from the HTML. */
  bodyText?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** `{{name}}` or `{{ name }}`, where name is an identifier. */
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** The distinct placeholder names used in `source`, in order of first use. */
export function extractPlaceholders(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(PLACEHOLDER_PATTERN)) found.add(match[1]);
  return [...found];
}

/** The placeholders used in any of `sources` that are not one of the supported ones. */
export function findUnknownPlaceholders(...sources: Array<string | null | undefined>): string[] {
  const unknown = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const name of extractPlaceholders(source)) {
      if (!TEMPLATE_PLACEHOLDER_NAMES.has(name)) unknown.add(name);
    }
  }
  return [...unknown];
}

/** A value for a header or a text part: no line breaks (a line break in a subject would be header injection). */
export function stripLineBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** The value sent for `name`; own properties only, so a placeholder can never reach `constructor` or `__proto__`. */
function valueOf(values: TemplateValues, name: string): string {
  return Object.prototype.hasOwnProperty.call(values, name) ? (values[name] ?? '') : '';
}

/**
 * Fills the placeholders of `source`. In `html` mode every value is HTML-escaped, so a name like `<script>` or `"><img onerror=…>` arrives as
 * text and can never become markup or break out of an attribute (the invitation link sits inside `href="…"`). In `text` mode a value is
 * only stripped of line breaks.
 */
export function fillTemplate(source: string, values: TemplateValues, mode: 'html' | 'text'): string {
  return source.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    const value = valueOf(values, name);
    return mode === 'html' ? escapeHtml(value) : stripLineBreaks(value);
  });
}

const NAMED_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** A readable plain-text version of template HTML: links keep their address, block ends become line breaks, tags are dropped. Works on the
 *  TEMPLATE (placeholders still in place), so values are added afterwards by fillTemplate in text mode. */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
      const text = label.replace(/<[^>]*>/g, '').trim();
      return text && text !== href ? `${text}: ${href}` : href;
    })
    .replace(/<\s*br\s*\/?>/gi, '\n')
    // Two cells of one row read as "label: value" (the details tables), whatever the label's own punctuation.
    .replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/gi, ': ')
    .replace(/<\/(p|h[1-6]|table)>/gi, '\n\n')
    .replace(/<\/(div|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => NAMED_ENTITIES[entity] ?? entity)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Renders a template into a finished message: the subject and text with line breaks removed from values, the HTML with every value escaped
 *  and wrapped in the responsive, branded layout. The branding owns `companyName` and `buttonColor`, so a template can use them (the button
 *  cell is `bgcolor="{{buttonColor}}"`) in every path — send, preview and test — without the caller having to supply them. */
export function renderEmail(template: RenderableTemplate, values: TemplateValues, options: { locale: string; branding: EmailBranding; year?: number }): RenderedEmail {
  const filled: TemplateValues = { ...values, companyName: options.branding.companyName, buttonColor: options.branding.buttonColor };
  const subject = stripLineBreaks(fillTemplate(template.subject, filled, 'text'));
  const bodyHtml = fillTemplate(template.bodyHtml, filled, 'html');
  const textSource = template.bodyText && template.bodyText.trim().length > 0 ? template.bodyText : htmlToText(template.bodyHtml);
  return {
    subject,
    html: renderEmailLayout(bodyHtml, { locale: options.locale, branding: options.branding, year: options.year }),
    text: fillTemplate(textSource, filled, 'text'),
  };
}
