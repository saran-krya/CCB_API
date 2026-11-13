import { createHash } from 'crypto';
import { DEFAULT_EMAIL_TEMPLATES } from './default-templates';
import { isSupersededDefaultBody } from './legacy-default-bodies';

describe('isSupersededDefaultBody', () => {
  it('does not treat the current built-in bodies as superseded, so a refreshed template is never refreshed again', () => {
    for (const template of DEFAULT_EMAIL_TEMPLATES) {
      expect(isSupersededDefaultBody(template.key, template.locale, template.bodyHtml)).toBe(false);
    }
  });

  it('does not touch an edited body, an empty one, or a message it has no fingerprint for', () => {
    const [template] = DEFAULT_EMAIL_TEMPLATES;
    expect(isSupersededDefaultBody(template.key, template.locale, `${template.bodyHtml}<p>edited</p>`)).toBe(false);
    expect(isSupersededDefaultBody(template.key, template.locale, '')).toBe(false);
    expect(isSupersededDefaultBody('MY_CUSTOM_MESSAGE', 'en', template.bodyHtml)).toBe(false);
  });

  it('is keyed by message and language: the right text under the wrong language is not recognised', () => {
    // A stand-in for "a body that hashes to the fingerprint of another entry": it can never match, because the hash is of the whole text.
    const wrong = createHash('sha256').update('x').digest('hex');
    expect(isSupersededDefaultBody('STAFF_INVITATION', 'en', wrong)).toBe(false);
    expect(isSupersededDefaultBody('STAFF_INVITATION', 'fr', 'anything')).toBe(false);
  });
});
