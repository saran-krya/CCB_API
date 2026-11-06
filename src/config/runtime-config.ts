import { DURATION_UNIT_MS } from '../common/constants/time.constants';
import { APP_ENVIRONMENT } from '../common/constants/env.constants';

/**
 * Pure helpers that turn the process environment into runtime behaviour — kept free of Nest/TypeORM so
 * every rule is unit-testable and shared by main.ts, typeorm.config.ts, env.validation.ts and the auth
 * controller (refresh cookie). The one idea running through all of them is FAIL SAFE: anything that is
 * not explicitly a local developer machine (NODE_ENV=development) or a test run is treated as
 * production-like, so a missing or mistyped NODE_ENV can only ever make the app stricter.
 */
export type AppEnvironment = (typeof APP_ENVIRONMENT)[keyof typeof APP_ENVIRONMENT];

type Env = Record<string, string | undefined>;

/** `NODE_ENV` normalised. Only exactly "development" or "test" are relaxed; "production", "uat",
 *  "staging", a typo, or no value at all are all production-like. */
export function resolveAppEnvironment(nodeEnv: string | undefined): AppEnvironment {
  const value = (nodeEnv ?? '').trim().toLowerCase();
  return value === APP_ENVIRONMENT.DEVELOPMENT || value === APP_ENVIRONMENT.TEST ? value : APP_ENVIRONMENT.PRODUCTION;
}

/** "1/true/yes/on" (any case) is true, any other non-blank value is false, blank/absent is `fallback`. */
export function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/** "30s" / "15m" / "1h" / "7d" -> milliseconds. The same format JWT_EXPIRES_IN and
 *  REFRESH_TOKEN_EXPIRES_IN already use. */
export function durationToMs(value: string): number {
  const match = value.trim().match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration "${value}" (expected e.g. 30s, 15m, 1h or 7d)`);
  return Number(match[1]) * DURATION_UNIT_MS[match[2]];
}

/**
 * The refresh-token lifetime a session gets, as the compact duration string that is applied ("7d", "30d"). A normal
 * sign-in gets `standard` (REFRESH_TOKEN_EXPIRES_IN); a "Remember me" sign-in gets `remembered`
 * (REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN) — but never less than `standard`, so ticking the box can only ever lengthen a
 * session, whatever the two settings say. Both must be valid durations (durationToMs throws otherwise).
 */
export function refreshTokenLifetime(rememberMe: boolean, standard: string, remembered: string): string {
  if (!rememberMe) return standard;
  return durationToMs(remembered) >= durationToMs(standard) ? remembered : standard;
}

/** True for obvious "fill me in" values (`__SET_UAT_VALUE__`, `CHANGE_ME`, `your-secret`, `changeme`, ...)
 *  so a template that was never completed can never be mistaken for a real secret. */
export function isPlaceholderSecret(value: string): boolean {
  const v = value.trim();
  return (
    /^_*(set|replace|change|todo|example|your)[-_a-z0-9]*_*$/i.test(v) ||
    /^(changeme|secret|password|jwt[-_]?secret|admin|test|dev)$/i.test(v)
  );
}

export interface DatabaseBehaviour {
  synchronize: boolean;
  logging: boolean;
  migrationsRun: boolean;
}


export function resolveDatabaseBehaviour(env: Env): DatabaseBehaviour {
  const appEnv = resolveAppEnvironment(env.NODE_ENV);
  if (appEnv !== APP_ENVIRONMENT.DEVELOPMENT && readBoolean(env.DB_SYNCHRONIZE, false)) {
    throw new Error('DB_SYNCHRONIZE=true is only allowed on a local developer machine (NODE_ENV=development).');
  }
  return {
    synchronize: appEnv === APP_ENVIRONMENT.DEVELOPMENT && readBoolean(env.DB_SYNCHRONIZE, true),
    logging: appEnv === APP_ENVIRONMENT.DEVELOPMENT && readBoolean(env.DB_LOGGING, true),
    migrationsRun: readBoolean(env.DB_MIGRATIONS_RUN, true),
  };
}

/** The browser origins allowed to call the API (CORS_ORIGINS, comma-separated, no wildcard). Nothing is
 *  allowed unless configured — except on a developer machine, where the local web app's two usual
 *  origins are allowed by default. */
export function resolveCorsOrigins(env: Env): string[] {
  const configured = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin !== '' && origin !== '*');
  if (configured.length > 0) return configured;
  return resolveAppEnvironment(env.NODE_ENV) === APP_ENVIRONMENT.DEVELOPMENT
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : [];
}

/** Swagger UI and the OpenAPI JSON list every route, so they are on by default only for a developer
 *  machine; elsewhere they need an explicit SWAGGER_ENABLED=true. */
export function resolveSwaggerEnabled(env: Env): boolean {
  return readBoolean(env.SWAGGER_ENABLED, resolveAppEnvironment(env.NODE_ENV) === APP_ENVIRONMENT.DEVELOPMENT);
}

/** Express "trust proxy": how many reverse-proxy hops to believe X-Forwarded-For from, so `req.ip` (used
 *  by rate limiting and login history) is the real client. Unset = trust nobody, which is correct when
 *  the API is reached directly. A number means that many hops; any other value is passed through
 *  (e.g. "loopback" or a CIDR list). */
export function resolveTrustProxy(env: Env): boolean | number | string {
  const raw = (env.TRUST_PROXY ?? '').trim();
  if (raw === '' || raw.toLowerCase() === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export interface RefreshCookieSettings {
  name: string;
  path: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  domain?: string;
}

/**
 * The refresh-token cookie: HttpOnly always; Secure by default in production-like environments (a
 * SameSite=None cookie is always Secure, browsers refuse it otherwise); scoped to the auth routes only,
 * so it is never attached to ordinary API calls. Its lifetime is NOT a setting here: it belongs to the
 * session — a "Remember me" session gets a persistent cookie as long as its refresh token, every other
 * session a browser-session cookie (see setRefreshCookie in auth/refresh-cookie.ts).
 */
export function resolveRefreshCookieSettings(env: Env): RefreshCookieSettings {
  const sameSiteRaw = (env.COOKIE_SAMESITE ?? 'lax').trim().toLowerCase();
  if (sameSiteRaw !== 'lax' && sameSiteRaw !== 'strict' && sameSiteRaw !== 'none') {
    throw new Error('COOKIE_SAMESITE must be one of: lax, strict, none.');
  }
  const prefix = (env.API_PREFIX ?? 'api').trim().replace(/^\/+|\/+$/g, '');
  return {
    name: env.REFRESH_COOKIE_NAME?.trim() || 'ccb_rt',
    path: `/${prefix}/v1/auth`,
    secure: sameSiteRaw === 'none' ? true : readBoolean(env.COOKIE_SECURE, resolveAppEnvironment(env.NODE_ENV) === APP_ENVIRONMENT.PRODUCTION),
    sameSite: sameSiteRaw,
    domain: env.COOKIE_DOMAIN?.trim() || undefined,
  };
}
