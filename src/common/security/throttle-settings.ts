import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { MS_PER_SECOND } from '../constants/time.constants';

const intFromEnv = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** A Node timer holds at most 2^31-1 ms (about 24.8 days); a longer delay is silently shortened to 1 ms, which
 *  would make the in-memory limiter forget every hit at once and stop limiting. A window that long is treated as
 *  garbage, exactly like a non-numeric value, and the default is used instead. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const windowMsFromEnv = (name: string, fallbackSeconds: number): number => {
  const seconds = intFromEnv(name, fallbackSeconds);
  return seconds * MS_PER_SECOND <= MAX_TIMER_MS ? seconds * MS_PER_SECOND : fallbackSeconds * MS_PER_SECOND;
};

/**
 * Request-rate limiting (per client IP — `req.ip`, honouring TRUST_PROXY), applied to every route by the
 * global ThrottlerGuard. The default is generous because one office/NAT address may carry many staff using
 * the app at once; it exists to stop floods, not to meter normal use. Tunable via THROTTLE_LIMIT (600) and
 * THROTTLE_TTL_SECONDS (60). The sign-in, token and credential routes override it with the much stricter
 * `strictRateLimit` below.
 */
export function throttlerModuleOptions(): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: windowMsFromEnv('THROTTLE_TTL_SECONDS', 60),
        limit: intFromEnv('THROTTLE_LIMIT', 600),
      },
    ],
    errorMessage: 'Too many requests. Please slow down and try again shortly.',
  };
}

/**
 * The stricter per-IP limit for routes an attacker would hammer: sign-in, token refresh, customer
 * activation, password change and the admin credential actions. Resolved per request so the limits can be
 * tuned (THROTTLE_AUTH_LIMIT, default 10; THROTTLE_AUTH_TTL_SECONDS, default 60) without a rebuild. It
 * works alongside LoginAttemptsService, which locks an ACCOUNT after repeated failures regardless of IP.
 */
export const strictRateLimit = () => ({
  default: {
    limit: () => intFromEnv('THROTTLE_AUTH_LIMIT', 10),
    ttl: () => windowMsFromEnv('THROTTLE_AUTH_TTL_SECONDS', 60),
  },
});
