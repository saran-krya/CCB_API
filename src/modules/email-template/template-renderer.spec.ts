import { DEFAULT_EMAIL_TEMPLATES, findDefaultTemplate } from './default-templates';
import { DEFAULT_HEADER_COLOR, EmailBranding } from './email-branding';
import { EMAIL_LOCALES, SYSTEM_TEMPLATE_KEY, TEMPLATE_PLACEHOLDER } from './email-template.constants';
import { emailLocaleOf, formatExpiryTime, maskEmailAddress } from './mail-text.util';
import { extractPlaceholders, fillTemplate, findUnknownPlaceholders, htmlToText, renderEmail } from './template-renderer';

const BRANDING: EmailBranding = { companyName: 'Acme', logoUrl: null, headerColor: '#1F2937', buttonColor: '#185FA5', footerText: null };

const SAMPLE_VALUES = {
  firstName: 'Sara',
  lastName: 'Ahmed',
  email: 'sara@example.com',
  invitedBy: 'Admin',
  invitationLink: 'https://app.example.com/accept-invitation?token=abc',
  expiryTime: 'in 24 hours',
  signInLink: 'https://app.example.com/login',
  customerReference: 'CUST-000123',
  depositAmount: 'AED 1,000.00',
};

describe('placeholders', () => {
  it('lists each placeholder once, in order of first use, with or without spaces inside the braces', () => {
    expect(extractPlaceholders('Hi {{firstName}} {{ lastName }} {{firstName}}')).toEqual(['firstName', 'lastName']);
  });

  it('reports the ones that are not supported', () => {
    expect(findUnknownPlaceholders('{{firstName}} {{password}}', null, undefined, '{{secret}}')).toEqual(['password', 'secret']);
    expect(findUnknownPlaceholders('{{firstName}} {{signInLink}} {{buttonColor}} {{depositAmount}}')).toEqual([]);
  });
});

describe('fillTemplate', () => {
  it('escapes every value in HTML, so a value can never become markup', () => {
    expect(fillTemplate('<p>{{firstName}}</p>', { firstName: '<b>x</b>' }, 'html')).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
  });

  it('escapes a value that is put inside an attribute, so it cannot break out of it', () => {
    expect(fillTemplate('<a href="{{invitationLink}}">', { invitationLink: 'https://x.test/a?b=1&c="2"' }, 'html')).toBe(
      '<a href="https://x.test/a?b=1&amp;c=&quot;2&quot;">',
    );
  });

  it('removes line breaks from values in text, so a value cannot add a header line', () => {
    expect(fillTemplate('Hi {{firstName}}', { firstName: 'A\r\nB' }, 'text')).toBe('Hi A B');
  });

  it('renders a missing value as nothing, and never reaches an inherited property', () => {
    expect(fillTemplate('[{{lastName}}]', {}, 'html')).toBe('[]');
    // Valid placeholder names that happen to be inherited object members still resolve to nothing: only the value's own properties are read.
    expect(fillTemplate('[{{constructor}}]', {}, 'html')).toBe('[]');
    expect(fillTemplate('[{{toString}}]', {}, 'html')).toBe('[]');
  });

  it('leaves text that is not a placeholder name as it is', () => {
    // A name must start with a letter (see PLACEHOLDER_PATTERN), so this is plain text: it is never looked up at all.
    expect(fillTemplate('[{{__proto__}}]', {}, 'html')).toBe('[{{__proto__}}]');
  });
});

describe('htmlToText', () => {
  it('keeps a link readable, ends paragraphs with a blank line and drops the tags', () => {
    expect(htmlToText('<p>Hello</p><a href="{{invitationLink}}">Accept</a>')).toBe('Hello\n\nAccept: {{invitationLink}}');
  });

  it('separates a heading from the text after it', () => {
    expect(htmlToText('<h1>Title</h1><p>Body</p>')).toBe('Title\n\nBody');
  });

  it('reads the two cells of a details row as "label: value"', () => {
    expect(htmlToText('<table><tr><td>Account</td><td>sara@x.test</td></tr></table>')).toBe('Account: sara@x.test');
  });

  it('turns entities back into characters', () => {
    expect(htmlToText('<p>A &amp; B</p>')).toBe('A & B');
  });
});

describe('renderEmail', () => {
  it('never lets a value put a line break in the subject', () => {
    const rendered = renderEmail({ subject: 'Hi {{firstName}}', bodyHtml: '<p>x</p>' }, { firstName: 'A\r\nBcc: evil@x.test' }, { locale: 'en', branding: BRANDING });
    expect(rendered.subject).not.toMatch(/[\r\n]/);
    expect(rendered.subject).toBe('Hi A Bcc: evil@x.test');
  });

  it('makes the plain-text version from the HTML when none was written, with the values filled in', () => {
    const rendered = renderEmail(
      { subject: 's', bodyHtml: '<p>Hello</p><a href="{{invitationLink}}">Accept</a>' },
      { invitationLink: 'https://x.test/t' },
      { locale: 'en', branding: BRANDING },
    );
    expect(rendered.text).toContain('Accept: https://x.test/t');
  });

  it('escapes the company name in the layout', () => {
    const rendered = renderEmail({ subject: 's', bodyHtml: '<p>x</p>' }, {}, { locale: 'en', branding: { ...BRANDING, companyName: '<i>Acme</i>' } });
    expect(rendered.html).toContain('&lt;i&gt;Acme&lt;/i&gt;');
    expect(rendered.html).not.toContain('<i>Acme');
  });

  it('lays an Arabic message out right to left, and an English one left to right', () => {
    const arabic = renderEmail({ subject: 's', bodyHtml: '<p>x</p>' }, {}, { locale: 'ar', branding: BRANDING });
    expect(arabic.html).toContain('dir="rtl"');
    expect(arabic.html).toContain('lang="ar"');
    const english = renderEmail({ subject: 's', bodyHtml: '<p>x</p>' }, {}, { locale: 'en', branding: BRANDING });
    expect(english.html).toContain('dir="ltr"');
  });

  it('owns {{companyName}} and {{buttonColor}}: the branding fills them whatever the caller passed', () => {
    const rendered = renderEmail(
      { subject: 'Welcome to {{companyName}}', bodyHtml: '<table><tr><td bgcolor="{{buttonColor}}">{{companyName}}</td></tr></table>' },
      { companyName: 'Somebody else', buttonColor: '#000000' },
      { locale: 'en', branding: { ...BRANDING, buttonColor: '#112233' } },
    );
    expect(rendered.subject).toBe('Welcome to Acme');
    expect(rendered.html).toContain('bgcolor="#112233"');
    expect(rendered.html).not.toContain('Somebody else');
  });
});

describe('the branded layout', () => {
  const render = (branding: EmailBranding, locale = 'en') => renderEmail({ subject: 's', bodyHtml: '<p>x</p>' }, {}, { locale, branding }).html;

  it('uses the configured colour for the brand tile and the top edge of the card', () => {
    const html = render({ ...BRANDING, headerColor: '#445566' });
    expect(html).toContain('bgcolor="#445566"');
    expect(html).toContain('background-color:#445566');
    expect(html).toContain('border-top:4px solid #445566');
  });

  it('puts the brand block on the page and the footer under the card, not on coloured bands', () => {
    const html = render(BRANDING);
    expect(html.indexOf('>A</td>')).toBeLessThan(html.indexOf('<p>x</p>'));
    expect(html.indexOf('<p>x</p>')).toBeLessThan(html.indexOf('Please do not reply'));
    expect(html).not.toContain('border-radius:12px 12px 0 0');
    expect(html).toContain('text-align:center');
  });

  it('adds the copyright line with the year, in the message language', () => {
    const at = (locale: string) => renderEmail({ subject: 's', bodyHtml: '<p>x</p>' }, {}, { locale, branding: BRANDING, year: 2031 }).html;
    expect(at('en')).toContain('© 2031 Acme. All rights reserved.');
    expect(at('ar')).toContain('© 2031 Acme. جميع الحقوق محفوظة.');
  });

  it('falls back to the default header colour when it is handed something that is not a colour', () => {
    const html = render({ ...BRANDING, headerColor: 'red;"><script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain(`bgcolor="${DEFAULT_HEADER_COLOR}"`);
  });

  it('shows the logo when there is one, escaped, with the company name as its alternative text', () => {
    const html = render({ ...BRANDING, logoUrl: 'https://cdn.example.com/logo.png?a=1&b=2' });
    expect(html).toContain('<img src="https://cdn.example.com/logo.png?a=1&amp;b=2"');
    expect(html).toContain('alt="Acme"');
  });

  it('shows the initial and the name instead when there is no logo', () => {
    const html = render(BRANDING);
    expect(html).not.toContain('<img');
    expect(html).toContain('>A</td>');
  });

  it('uses the built-in footer sentence, or the administrator\'s own text with line breaks kept and every character escaped', () => {
    expect(render(BRANDING)).toContain('Please do not reply to this email.');
    const custom = render({ ...BRANDING, footerText: 'Line one\nLine two <b>' });
    expect(custom).toContain('Line one<br />Line two &lt;b&gt;');
    expect(custom).not.toContain('Please do not reply');
  });

  it('writes the built-in footer in Arabic for an Arabic message', () => {
    expect(render(BRANDING, 'ar')).toContain('يرجى عدم الرد على هذا البريد الإلكتروني');
  });
});

describe('the built-in templates', () => {
  const MESSAGE_KEYS = Object.values(SYSTEM_TEMPLATE_KEY);
  const LINK_KEYS = [
    SYSTEM_TEMPLATE_KEY.STAFF_INVITATION,
    SYSTEM_TEMPLATE_KEY.CUSTOMER_INVITATION,
    SYSTEM_TEMPLATE_KEY.CUSTOMER_DEPOSIT_INVITATION,
    SYSTEM_TEMPLATE_KEY.INVITATION_RESENT,
  ];

  it('exist for every system message in every language, six messages in two languages', () => {
    for (const key of MESSAGE_KEYS) {
      for (const locale of EMAIL_LOCALES) expect(findDefaultTemplate(key, locale)).toBeDefined();
    }
    expect(MESSAGE_KEYS).toHaveLength(6);
    expect(DEFAULT_EMAIL_TEMPLATES).toHaveLength(MESSAGE_KEYS.length * EMAIL_LOCALES.length);
  });

  it('use only supported placeholders', () => {
    for (const template of DEFAULT_EMAIL_TEMPLATES) {
      expect(findUnknownPlaceholders(template.subject, template.bodyHtml)).toEqual([]);
    }
  });

  it('carry the accept link in every invitation message, the sign-in link in the activation one and no link in the expiry one', () => {
    for (const locale of EMAIL_LOCALES) {
      for (const key of LINK_KEYS) {
        expect(findDefaultTemplate(key, locale)?.bodyHtml).toContain(`{{${TEMPLATE_PLACEHOLDER.INVITATION_LINK}}}`);
      }
      expect(findDefaultTemplate(SYSTEM_TEMPLATE_KEY.ACCOUNT_ACTIVATED, locale)?.bodyHtml).toContain(`{{${TEMPLATE_PLACEHOLDER.SIGN_IN_LINK}}}`);
      expect(findDefaultTemplate(SYSTEM_TEMPLATE_KEY.INVITATION_EXPIRED, locale)?.bodyHtml).not.toContain('href=');
    }
  });

  it('give every message a heading, and every message with a link a button coloured by the setting plus the link again as text', () => {
    for (const template of DEFAULT_EMAIL_TEMPLATES) {
      expect(template.bodyHtml).toContain('<h1 ');
      const hasLink = template.key !== SYSTEM_TEMPLATE_KEY.INVITATION_EXPIRED;
      expect(template.bodyHtml.includes('bgcolor="{{buttonColor}}"')).toBe(hasLink);
      if (hasLink) {
        // The button's link and the copyable link: two uses of the same placeholder.
        const link = template.key === SYSTEM_TEMPLATE_KEY.ACCOUNT_ACTIVATED ? '{{signInLink}}' : '{{invitationLink}}';
        expect(template.bodyHtml.split(link).length - 1).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('carry, in the deposit message, the customer reference, the amount and what happens once the deposit is verified', () => {
    for (const locale of EMAIL_LOCALES) {
      const body = findDefaultTemplate(SYSTEM_TEMPLATE_KEY.CUSTOMER_DEPOSIT_INVITATION, locale)?.bodyHtml ?? '';
      expect(body).toContain('{{customerReference}}');
      expect(body).toContain('{{depositAmount}}');
      expect(body).toContain('{{expiryTime}}');
    }
    const english = findDefaultTemplate(SYSTEM_TEMPLATE_KEY.CUSTOMER_DEPOSIT_INVITATION, 'en');
    expect(english?.bodyHtml).toContain('deposit payment is verified');
  });

  it('render completely — no placeholder is left behind — and the Arabic ones are in Arabic', () => {
    for (const template of DEFAULT_EMAIL_TEMPLATES) {
      const rendered = renderEmail(template, SAMPLE_VALUES, { locale: template.locale, branding: BRANDING });
      expect(rendered.subject).not.toContain('{{');
      expect(rendered.html).not.toContain('{{');
      expect(rendered.text).not.toContain('{{');
      if (template.locale === 'ar') expect(template.subject).toMatch(/[؀-ۿ]/);
    }
  });

  it('read well as plain text: the deposit details come out as "label: value" lines', () => {
    const template = findDefaultTemplate(SYSTEM_TEMPLATE_KEY.CUSTOMER_DEPOSIT_INVITATION, 'en');
    const rendered = renderEmail(template!, SAMPLE_VALUES, { locale: 'en', branding: BRANDING });
    expect(rendered.text).toContain('Customer reference: CUST-000123');
    expect(rendered.text).toContain('Security Deposit: AED 1,000.00');
    expect(rendered.text).toContain(`Set password & pay deposit: ${SAMPLE_VALUES.invitationLink}`);
  });

  it('keep Latin-only typography out of Arabic, where letter-spacing and capitals break the letters apart', () => {
    for (const template of DEFAULT_EMAIL_TEMPLATES.filter((entry) => entry.locale === 'ar')) {
      expect(template.bodyHtml).not.toContain('letter-spacing');
      expect(template.bodyHtml).not.toContain('text-transform');
    }
  });
});

describe('mail text helpers', () => {
  it('masks the middle of an address', () => {
    expect(maskEmailAddress('sara@example.com')).toBe('s**a@example.com');
    expect(maskEmailAddress('ab@example.com')).toBe('**@example.com');
    expect(maskEmailAddress('not-an-address')).toBe('***');
  });

  it('picks Arabic for an Arabic preference and English for anything else', () => {
    expect(emailLocaleOf('ar')).toBe('ar');
    expect(emailLocaleOf('Arabic')).toBe('ar');
    expect(emailLocaleOf('English')).toBe('en');
    expect(emailLocaleOf(null)).toBe('en');
    expect(emailLocaleOf(undefined)).toBe('en');
  });

  it('states the lifetime and the moment it ends, in UTC', () => {
    const text = formatExpiryTime(new Date('2026-11-12T14:35:00Z'), 24, 'en');
    expect(text).toContain('in 24 hours');
    expect(text).toContain('UTC');
  });
});
