import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import {
  resolveAppEnvironment,
  resolveCorsOrigins,
  resolveSwaggerEnabled,
  resolveTrustProxy,
} from '../../config/runtime-config';
import { APP_ENVIRONMENT } from '../constants/env.constants';

/** Request headers a browser client may send cross-origin. `X-CCB-Client` is the marker the cookie-based
 *  auth routes require (see auth/refresh-cookie.ts): being a custom header it forces a CORS preflight,
 *  which only an allow-listed origin can pass. */
export const ALLOWED_REQUEST_HEADERS = ['Authorization', 'Content-Type', 'Accept', 'X-Device-Id', 'X-CCB-Client'];

/**
 * HTTP-level hardening applied once at startup (main.ts):
 *  - no `X-Powered-By` fingerprint;
 *  - Express `trust proxy` from TRUST_PROXY, so `req.ip` (rate limiting, login history) is the real
 *    client behind a reverse proxy and cannot be spoofed with X-Forwarded-For when there is none;
 *  - Helmet security headers (nosniff, frame denial, no-referrer, HSTS in production; a deny-everything
 *    CSP for this JSON API, relaxed only while Swagger UI is mounted, which needs inline assets);
 *  - CORS limited to the origins in CORS_ORIGINS (never a wildcard), with credentials allowed so the
 *    HttpOnly refresh cookie works from those origins only.
 */
export function configureHttpSecurity(app: NestExpressApplication, env: Record<string, string | undefined>): void {
  const appEnv = resolveAppEnvironment(env.NODE_ENV);

  app.disable('x-powered-by');
  app.set('trust proxy', resolveTrustProxy(env));

  app.use(
    helmet({
      contentSecurityPolicy: resolveSwaggerEnabled(env)
        ? false
        : { directives: { defaultSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"], frameAncestors: ["'none'"] } },
      // The web app loads API-served files (documents, images) cross-origin; the default
      // same-origin policy would block those embeds.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: appEnv === APP_ENVIRONMENT.PRODUCTION ? { maxAge: 15_552_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  const allowedOrigins = new Set(resolveCorsOrigins(env));
  app.enableCors({
    // No Origin header = not a browser cross-origin call (curl, server-to-server, same-origin): CORS is
    // not in play. Any browser origin that is not allow-listed simply gets no CORS headers.
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ALLOWED_REQUEST_HEADERS,
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  });
}
