import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EMAIL_TEMPLATE_MESSAGE } from './email-template.constants';

type SanitizeFn = (dirty: string, options?: Record<string, unknown>) => string;

/**
 * Loads the `sanitize-html` package only when it is first needed, and answers "not available" instead of failing when it is not installed.
 * It is a dependency of the API (package.json, exact version 2.17.5 — later versions need Node 22). Loading it lazily keeps the rest of the
 * API running if a deployment ever misses `npm ci`: saving, previewing or test-sending template HTML then refuses with a clear message
 * instead of the whole API failing to start. Sending the built-in or already-saved templates never needs it.
 */
function loadSanitizeHtml(): SanitizeFn | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded: unknown = require('sanitize-html');
    const candidate = (loaded as { default?: unknown }).default ?? loaded;
    return typeof candidate === 'function' ? (candidate as SanitizeFn) : null;
  } catch {
    return null;
  }
}

/** The HTML an e-mail template may contain: text, headings, lists, links, simple tables and images — no scripts, forms, frames, styles blocks or
 *  event handlers. */
const ALLOWED_TAGS = [
  'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'small', 'span',
  'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
];

const COMMON_ATTRIBUTES = ['style', 'dir', 'lang', 'align', 'title'];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': COMMON_ATTRIBUTES,
  a: ['href', 'target', 'rel', ...COMMON_ATTRIBUTES],
  img: ['src', 'alt', 'width', 'height', ...COMMON_ATTRIBUTES],
  table: ['role', 'width', 'cellpadding', 'cellspacing', 'border', 'bgcolor', ...COMMON_ATTRIBUTES],
  td: ['width', 'height', 'valign', 'colspan', 'rowspan', 'bgcolor', ...COMMON_ATTRIBUTES],
  th: ['width', 'height', 'valign', 'colspan', 'rowspan', 'bgcolor', ...COMMON_ATTRIBUTES],
  tr: ['valign', 'bgcolor', ...COMMON_ATTRIBUTES],
};

/** A CSS value without anything that can fetch or run something: no url(), expression(), javascript:, @import, backslash (a CSS escape can
 *  spell any of those), braces, semicolons or angle brackets. The look-ahead is `[\s\S]*`, not `.*`: `.` stops at a line break, and a value
 *  such as "red<line break>url(...)" must be refused as a whole. */
const SAFE_CSS_VALUE = /^(?![\s\S]*(?:url\s*\(|expression\s*\(|javascript:|@import|\\))[^;{}<>]*$/i;
const CSS_PROPERTIES = [
  'background', 'background-color', 'border', 'border-bottom', 'border-collapse', 'border-left', 'border-radius', 'border-right', 'border-top',
  'color', 'display', 'font-family', 'font-size', 'font-style', 'font-weight', 'height', 'letter-spacing', 'line-height', 'margin',
  'margin-bottom', 'margin-left', 'margin-right', 'margin-top', 'max-width', 'min-width', 'padding', 'padding-bottom', 'padding-left',
  'padding-right', 'padding-top', 'text-align', 'text-decoration', 'text-transform', 'vertical-align', 'width', 'word-break',
];

function buildOptions(): Record<string, unknown> {
  const allowedStyles: Record<string, RegExp[]> = {};
  for (const property of CSS_PROPERTIES) allowedStyles[property] = [SAFE_CSS_VALUE];

  return {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['https', 'http', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    allowedStyles: { '*': allowedStyles },
    // Every link opens in a new tab and never hands the opener to the page it leads to.
    transformTags: {
      a: (tagName: string, attribs: Record<string, string>) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
      }),
    },
  };
}

@Injectable()
export class EmailHtmlSanitizer {
  private sanitizeFn: SanitizeFn | null | undefined;

  private load(): SanitizeFn | null {
    if (this.sanitizeFn === undefined) this.sanitizeFn = loadSanitizeHtml();
    return this.sanitizeFn;
  }

  /** Whether the sanitizer package is installed. */
  isAvailable(): boolean {
    return this.load() !== null;
  }

  /** The template HTML with everything outside the allow-list removed. `{{placeholders}}` are plain text and pass through unchanged, including
   *  inside `href="…"`. 503 when the package is not installed — unsanitized HTML is never accepted as a fallback. */
  sanitize(html: string): string {
    const sanitize = this.load();
    if (!sanitize) throw new ServiceUnavailableException(EMAIL_TEMPLATE_MESSAGE.SANITIZER_MISSING);
    return sanitize(html, buildOptions()).trim();
  }
}
