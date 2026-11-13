import { createHash } from 'crypto';

/**
 * SHA-256 of the built-in message bodies the application shipped before the current e-mail design (key:locale), taken from the exact text the
 * database was seeded with. A stored built-in template whose body still hashes to one of these has never been edited by an administrator, so
 * it can be moved to the new built-in design on start-up without losing anyone's work — a body that differs in any character is someone's
 * edit and is never touched. (The old HTML itself is deliberately not kept: only these fingerprints are needed to recognise it.)
 */
const SUPERSEDED_DEFAULT_BODY_HASHES: Readonly<Record<string, string>> = {
  'STAFF_INVITATION:en': '9db19d9e23b6cdf953c7043387884eabe79f00316cc02870de6f2fb495929788',
  'CUSTOMER_INVITATION:en': 'c1ca2df2dd74f95a7a5625b78b218a1237270ce6b714fc013623fb323db007a3',
  'CUSTOMER_DEPOSIT_INVITATION:en': '2bbe71ca3b6bca04ae03ea57bda56f84713419b725f290177b5d4d43a36c5861',
  'INVITATION_RESENT:en': 'eb47daa1a92a033f3f40ffa9094ff4d21972b70b3a378ea9dca1f2e15c3b81af',
  'INVITATION_EXPIRED:en': '3e474b538bb3fccce62d4863767f55688b961ab4bfdc7ae9f855e82ee3d14094',
  'ACCOUNT_ACTIVATED:en': '32a077b43c86698478654092a27ac145aa9a72aca457102e90fe139a5daa7c4c',
  'STAFF_INVITATION:ar': '4c0c92db095acacbc190298661bcdf2092bae1e3c341c8a378673874d4cc884c',
  'CUSTOMER_INVITATION:ar': '526ef51d00e5bfb77e0dd01120f8f77b2939385865457762f90e5abe362774a0',
  'CUSTOMER_DEPOSIT_INVITATION:ar': '464968a5b7a17f16068c55f800c5f00e8198725499025fafeb35744f7a295d44',
  'INVITATION_RESENT:ar': '2abf8d292f302f62a92d6a14619a1d37bebee349761160363d8a12de507ddab1',
  'INVITATION_EXPIRED:ar': 'd30bac3e93ce808a3985d9873aeaec9bea10c98e1b600fce93077d23953af1ff',
  'ACCOUNT_ACTIVATED:ar': '1a66a7fb7d42911b4130963526d0ccdfb08b18f375238dbfceabed4b73544384',
};

/** Whether `bodyHtml` is, character for character, the built-in body the application used to ship for this message and language. */
export function isSupersededDefaultBody(key: string, locale: string, bodyHtml: string): boolean {
  const expected = SUPERSEDED_DEFAULT_BODY_HASHES[`${key}:${locale}`];
  return expected !== undefined && createHash('sha256').update(bodyHtml).digest('hex') === expected;
}
