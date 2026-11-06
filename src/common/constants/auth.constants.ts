/** Whose session / token it is: a staff user or a customer (portal) account. */
export const PRINCIPAL_TYPE = {
  STAFF: 'staff',
  CUSTOMER: 'customer',
} as const;

export type PrincipalType = (typeof PRINCIPAL_TYPE)[keyof typeof PRINCIPAL_TYPE];

/** Who performs a privileged write: a signed-in staff user, or the boot-time seed / migration path (no user). */
export const ACTOR_KIND = {
  USER: 'user',
  SYSTEM: 'system',
} as const;

/** bcrypt cost factor for every stored password (staff, customer and the seeded admin). */
export const PASSWORD_HASH_ROUNDS = 12;

/** Refresh-token lifetime used when REFRESH_TOKEN_EXPIRES_IN is not set. */
export const DEFAULT_REFRESH_TOKEN_EXPIRES_IN = '7d';

/** Refresh-token lifetime of a "Remember me" sign-in when REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN is not set. A remembered
 *  session is meant to outlast the browser being closed for days, so it defaults to a month (the normal lifetime is 7
 *  days); both are sliding — every refresh issues a token with a fresh full lifetime — and both can be set per
 *  environment. */
export const DEFAULT_REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN = '30d';

/** Token type returned alongside every access token. */
export const TOKEN_TYPE_BEARER = 'Bearer';

/** Request header carrying the browser's device id (lower-case: Node lower-cases incoming header names). */
export const DEVICE_ID_HEADER = 'x-device-id';
