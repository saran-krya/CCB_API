import { durationToMs, isPlaceholderSecret, resolveAppEnvironment } from './runtime-config';
import { isTrustProxyValue } from './trust-proxy';
import { ENV_KEY, APP_ENVIRONMENT } from '../common/constants/env.constants';

/** Secrets that must be a real value in every production-like environment. */
const REQUIRED_REAL_SECRETS = [ENV_KEY.JWT_SECRET, ENV_KEY.DB_PASSWORD, ENV_KEY.DEFAULT_ADMIN_PASSWORD] as const;

/** Minimum JWT signing-secret length. HS256 is only as strong as its key, and every user (staff and
 *  customer) holds a token signed with it, so a short secret can be brute-forced offline. */
export const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Startup validation, wired into ConfigModule.forRoot({ validate }). It refuses to boot on a
 * configuration that would be unsafe rather than starting with it. Problems are reported by KEY NAME
 * only — a value (secret or not) is never put in the message.
 *
 *  - JWT_SECRET: required, >= 32 characters, not a placeholder, not one repeated character (every
 *    environment except NODE_ENV=test, so a weak dev secret can't be promoted to UAT unnoticed).
 *  - Production-like environments additionally: no placeholder values left in the required secrets, the
 *    DB account is not `root`, and DB_SYNCHRONIZE is not enabled.
 *  - CORS_ORIGINS must list explicit origins; a wildcard is rejected everywhere.
 *  - REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN, when set, must be a valid duration (30d, 12h, ...).
 */
export function validateEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const env = raw as Record<string, string | undefined>;
  const appEnv = resolveAppEnvironment(env.NODE_ENV);
  const problems: string[] = [];

  if (appEnv !== APP_ENVIRONMENT.TEST) {
    const jwtSecret = env.JWT_SECRET;
    if (!jwtSecret) {
      problems.push('JWT_SECRET is required.');
    } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      problems.push(
        `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters of random data (for example: openssl rand -base64 48).`,
      );
    } else if (isPlaceholderSecret(jwtSecret) || /^(.)\1+$/.test(jwtSecret)) {
      problems.push('JWT_SECRET must be a real random secret, not a placeholder or a repeated character.');
    }
  }

  if (appEnv === APP_ENVIRONMENT.PRODUCTION) {
    for (const key of REQUIRED_REAL_SECRETS) {
      const value = env[key];
      if (value && isPlaceholderSecret(value)) problems.push(`${key} is still a placeholder — set a real value for this environment.`);
    }
    if ((env.DB_USERNAME ?? '').trim().toLowerCase() === 'root') {
      problems.push('DB_USERNAME must be a least-privilege application account, not root (see scripts/db/provision-db-users.sql).');
    }
    if (['1', 'true', 'yes', 'on'].includes((env.DB_SYNCHRONIZE ?? '').trim().toLowerCase())) {
      problems.push('DB_SYNCHRONIZE must not be enabled outside a local developer machine.');
    }
  }

  if ((env.CORS_ORIGINS ?? '').split(',').some((origin) => origin.trim() === '*')) {
    problems.push('CORS_ORIGINS must list explicit origins, not "*".');
  }

  // TRUST_PROXY decides whose X-Forwarded-For the API believes; "true" (trust every client) would let anyone choose the address the sign-in lock-out
  // and the request throttle see — see config/trust-proxy.ts.
  if (!isTrustProxyValue(env.TRUST_PROXY ?? '')) {
    problems.push('TRUST_PROXY must be the number of reverse-proxy hops in front of the API (for example 1), "loopback", or a list of IP addresses / CIDR ranges — not "true".');
  }

  // The "Remember me" refresh lifetime: a malformed value would otherwise only surface as a failed sign-in the first time
  // someone ticks the box. (An unset value is fine — it has a default — and a value shorter than REFRESH_TOKEN_EXPIRES_IN
  // is never used below that: see refreshTokenLifetime.)
  const rememberMeLifetime = env[ENV_KEY.REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN]?.trim();
  if (rememberMeLifetime) {
    try {
      durationToMs(rememberMeLifetime);
    } catch {
      problems.push(`${ENV_KEY.REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN} must be a duration such as 30d, 12h, 90m or 3600s.`);
    }
  }


  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
  }
  return raw;
}
