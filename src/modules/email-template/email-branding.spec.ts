import {
  BRANDING_MESSAGE,
  DEFAULT_BUTTON_COLOR,
  DEFAULT_HEADER_COLOR,
  FOOTER_TEXT_MAX_LENGTH,
  brandingFor,
  contrastRatio,
  isHexColor,
  isReadableButtonColor,
  isValidLogoUrl,
  mixColors,
  normalizeHexColor,
  readableTextColor,
  resolveBranding,
  validateBrandingInput,
} from './email-branding';

describe('colours', () => {
  it('accepts exactly #RRGGBB', () => {
    expect(isHexColor('#185FA5')).toBe(true);
    expect(isHexColor('#abcdef')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('185FA5')).toBe(false);
    expect(isHexColor('#12345G')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor(123)).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });

  it('writes a colour in capitals', () => {
    expect(normalizeHexColor('#abcdef')).toBe('#ABCDEF');
  });

  it('measures contrast the WCAG way', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 3);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 3);
    expect(contrastRatio('#185FA5', '#185FA5')).toBeCloseTo(1, 5);
  });

  it('chooses white or near-black text, whichever reads better on the background', () => {
    expect(readableTextColor('#000000')).toBe('#FFFFFF');
    expect(readableTextColor(DEFAULT_HEADER_COLOR)).toBe('#FFFFFF');
    expect(readableTextColor('#FFFFFF')).toBe('#111827');
    expect(readableTextColor('#FFD60A')).toBe('#111827');
  });

  it('accepts a button colour only when its white label can be read on it (4.5:1)', () => {
    expect(isReadableButtonColor(DEFAULT_BUTTON_COLOR)).toBe(true);
    expect(isReadableButtonColor('#000000')).toBe(true);
    // The old default blue is about 3.6:1 against white — too light, which is why the default is darker.
    expect(isReadableButtonColor('#378ADD')).toBe(false);
    expect(isReadableButtonColor('#FFFFFF')).toBe(false);
    expect(isReadableButtonColor('#FFFF00')).toBe(false);
  });

  it('mixes two colours', () => {
    expect(mixColors('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixColors('#1F2937', '#FFFFFF', 0)).toBe('#1F2937');
    expect(mixColors('#1F2937', '#FFFFFF', 1)).toBe('#FFFFFF');
  });
});

describe('the logo address', () => {
  it('accepts an https address', () => {
    expect(isValidLogoUrl('https://cdn.example.com/logo.png')).toBe(true);
    expect(isValidLogoUrl('https://x.test/a.png?v=2&w=3')).toBe(true);
  });

  it('refuses anything else: other schemes, credentials, whitespace, quotes and angle brackets, nothing, or too long', () => {
    expect(isValidLogoUrl('http://x.test/a.png')).toBe(false);
    expect(isValidLogoUrl('javascript:alert(1)')).toBe(false);
    expect(isValidLogoUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isValidLogoUrl('https://user:secret@x.test/a.png')).toBe(false);
    expect(isValidLogoUrl('https://x.test/a b.png')).toBe(false);
    expect(isValidLogoUrl('https://x.test/a".png')).toBe(false);
    expect(isValidLogoUrl("https://x.test/a'.png")).toBe(false);
    expect(isValidLogoUrl('https://x.test/<img>')).toBe(false);
    expect(isValidLogoUrl('https://')).toBe(false);
    expect(isValidLogoUrl('')).toBe(false);
    expect(isValidLogoUrl(`https://x.test/${'a'.repeat(500)}.png`)).toBe(false);
    expect(isValidLogoUrl(undefined)).toBe(false);
  });
});

describe('what an administrator may enter', () => {
  it('has nothing to say about empty values: empty always means "use the default"', () => {
    expect(validateBrandingInput({})).toEqual({});
    expect(validateBrandingInput({ logoUrl: '', headerColor: '', buttonColor: '' })).toEqual({});
    expect(validateBrandingInput({ logoUrl: null, headerColor: null, buttonColor: null })).toEqual({});
    expect(validateBrandingInput({ logoUrl: '   ' })).toEqual({});
  });

  it('names the field that is wrong, and why', () => {
    expect(validateBrandingInput({ logoUrl: 'http://x.test/a.png' })).toEqual({ logoUrl: BRANDING_MESSAGE.LOGO_INVALID });
    expect(validateBrandingInput({ headerColor: 'blue' })).toEqual({ headerColor: BRANDING_MESSAGE.COLOR_INVALID });
    expect(validateBrandingInput({ buttonColor: 'nope' })).toEqual({ buttonColor: BRANDING_MESSAGE.COLOR_INVALID });
    expect(validateBrandingInput({ buttonColor: '#FFFF00' })).toEqual({ buttonColor: BRANDING_MESSAGE.BUTTON_TOO_LIGHT });
  });

  it('lets a header be any colour (its text adapts) but holds the button to a readable one', () => {
    expect(validateBrandingInput({ headerColor: '#FFFF00', buttonColor: '#185FA5' })).toEqual({});
  });
});

describe('resolving what is stored', () => {
  const DEFAULTS = { companyName: 'CCB' };

  it('uses the defaults for everything that is missing or empty', () => {
    expect(resolveBranding({}, DEFAULTS)).toEqual({
      companyName: 'CCB',
      logoUrl: null,
      headerColor: DEFAULT_HEADER_COLOR,
      buttonColor: DEFAULT_BUTTON_COLOR,
      footerTextEn: null,
      footerTextAr: null,
    });
    expect(resolveBranding({ companyName: '  ', logoUrl: '', headerColor: ' ', buttonColor: null }, DEFAULTS).companyName).toBe('CCB');
  });

  it('keeps valid values, colours in capitals', () => {
    const resolved = resolveBranding(
      { companyName: ' Acme ', logoUrl: 'https://x.test/l.png', headerColor: '#abcdef', buttonColor: '#185fa5', footerTextEn: ' Hi ', footerTextAr: 'مرحبا' },
      DEFAULTS,
    );
    expect(resolved).toEqual({
      companyName: 'Acme',
      logoUrl: 'https://x.test/l.png',
      headerColor: '#ABCDEF',
      buttonColor: '#185FA5',
      footerTextEn: 'Hi',
      footerTextAr: 'مرحبا',
    });
  });

  it('never trusts a stored value that was edited somewhere else: an invalid colour, a too-light button, a bad logo or an oversize footer is dropped', () => {
    const resolved = resolveBranding(
      {
        logoUrl: 'javascript:alert(1)',
        headerColor: 'red;"><script>',
        buttonColor: '#FFFF00',
        footerTextEn: 'x'.repeat(FOOTER_TEXT_MAX_LENGTH + 1),
      },
      DEFAULTS,
    );
    expect(resolved.logoUrl).toBeNull();
    expect(resolved.headerColor).toBe(DEFAULT_HEADER_COLOR);
    expect(resolved.buttonColor).toBe(DEFAULT_BUTTON_COLOR);
    expect(resolved.footerTextEn).toBeNull();
  });

  it('picks the footer of the message\'s language', () => {
    const resolved = resolveBranding({ footerTextEn: 'English footer', footerTextAr: 'تذييل عربي' }, DEFAULTS);
    expect(brandingFor(resolved, 'ar').footerText).toBe('تذييل عربي');
    expect(brandingFor(resolved, 'en').footerText).toBe('English footer');
    expect(brandingFor(resolved, 'fr').footerText).toBe('English footer');
    expect(brandingFor(resolveBranding({ footerTextEn: 'Only English' }, DEFAULTS), 'ar').footerText).toBeNull();
  });
});
