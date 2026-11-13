import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateEmailSettingsDto } from './email-template.dto';

/** Runs a payload through the same two steps the global ValidationPipe does: convert with implicit conversion, then validate with whitelist
 *  and forbidNonWhitelisted. Resolves to the names of the properties that failed. */
async function failures(plain: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(UpdateEmailSettingsDto, plain, { enableImplicitConversion: true }), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property).sort();
}

describe('UpdateEmailSettingsDto', () => {
  it('needs a company name and nothing else', async () => {
    expect(await failures({ companyName: 'Acme' })).toEqual([]);
    expect(await failures({})).toEqual(['companyName']);
    expect(await failures({ companyName: '   ' })).toEqual(['companyName']);
  });

  it('takes every branding setting, and lets any of them be null (the default) or empty', async () => {
    expect(
      await failures({
        companyName: 'Acme',
        logoUrl: 'https://cdn.example.com/logo.png',
        headerColor: '#1F2937',
        buttonColor: '#185FA5',
        footerTextEn: 'English footer',
        footerTextAr: 'تذييل عربي',
      }),
    ).toEqual([]);
    expect(await failures({ companyName: 'Acme', logoUrl: null, headerColor: null, buttonColor: null, footerTextEn: null, footerTextAr: null })).toEqual([]);
    expect(await failures({ companyName: 'Acme', logoUrl: '', headerColor: '', buttonColor: '', footerTextEn: '', footerTextAr: '' })).toEqual([]);
  });

  it('refuses a value that is too long, a value that is not text, and a field it does not know', async () => {
    expect(await failures({ companyName: 'Acme', headerColor: '#1234567' })).toEqual(['headerColor']);
    expect(await failures({ companyName: 'Acme', footerTextEn: 'x'.repeat(501) })).toEqual(['footerTextEn']);
    expect(await failures({ companyName: 'Acme', logoUrl: `https://x.test/${'a'.repeat(500)}` })).toEqual(['logoUrl']);
    expect(await failures({ companyName: 'Acme', buttonColor: 5 })).toEqual(['buttonColor']);
    expect(await failures({ companyName: 'Acme', bogus: true })).toEqual(['bogus']);
  });
});
