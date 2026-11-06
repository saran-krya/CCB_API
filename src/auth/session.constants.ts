import { MS_PER_MINUTE } from '../common/constants/time.constants';

/**
 * Session handling (Active Sessions, sign-out, login history, the session timeout). A SESSION is one
 * refresh-token family: a server-generated UUID created at sign-in and carried across refresh rotations. It is
 * signed into every access token as `sid`, and JwtStrategy requires it to be live on every request.
 */

/** How long (seconds) JwtStrategy may remember that a session was live. Every revocation path forgets the keys it
 *  revokes (SessionLivenessService.forget), so this only bounds a Redis outage or a revocation made by another
 *  process; a cache miss or a Redis error always falls back to the database. */
export const SESSION_LIVENESS_CACHE_TTL_SECONDS = 5;

/** What an `X-Device-Id` header may look like: a bounded, plain token (the web app sends a UUID; the column is
 *  varchar(36)). The header is a grouping LABEL for the sessions list and is never trusted as an identity — a value
 *  that does not match is treated as absent. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;

/** Minutes of inactivity before the web app signs the user out — and the lifetime of an access token — when neither
 *  the SESSION_TIMEOUT_MINUTES attribute nor the SESSION_TIMEOUT_MINUTES environment variable holds a usable value.
 *  Equal to the seed default and to the lowest value the attribute accepts. */
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;

/** The fallback warning is logged at most this often, so a missing attribute does not flood the log (the resolver runs on
 *  every sign-in, refresh and app-shell bootstrap). */
export const SESSION_TIMEOUT_WARNING_INTERVAL_MS = 10 * MS_PER_MINUTE;

/** Where a Login History row stands, computed when it is read (never stored). */
export const LOGIN_HISTORY_STATUS = {
  /** Not signed out, and a live session still exists for that device. */
  ACTIVE: 'active',
  /** Signed out — by the user, by an admin, or replaced by a newer sign-in from the same device. */
  SIGNED_OUT: 'signed_out',
  /** Never signed out, but no live session is left: it lapsed or was abandoned. */
  EXPIRED: 'expired',
} as const;

export type LoginHistoryStatus = (typeof LOGIN_HISTORY_STATUS)[keyof typeof LOGIN_HISTORY_STATUS];

/** Audit `action` of the self-service session actions (the admin variants keep their own actions in AuthService). */
export const SESSION_AUDIT_ACTION = {
  LOGOUT: 'LOGOUT',
  REVOKE_DEVICE: 'REVOKE_DEVICE',
  REVOKE_OTHER_SESSIONS: 'REVOKE_OTHER_SESSIONS',
  LOGOUT_ALL: 'LOGOUT_ALL',
} as const;

/** Why other sessions were revoked, when it was a side effect of another action. */
export const SESSION_REVOKE_REASON = {
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
} as const;

export const SESSION_ERROR_MESSAGES = {
  /** JwtStrategy: the access token's session was signed out, revoked or has expired. */
  SESSION_ENDED: 'Session is no longer active',
} as const;
