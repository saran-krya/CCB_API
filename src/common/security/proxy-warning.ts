import type { RequestHandler } from 'express';
import { resolveTrustProxy } from '../../config/runtime-config';

/**
 * Says so, once, when requests arrive through a reverse proxy that the API has not been told about. A forwarded-address header (X-Forwarded-For,
 * X-Real-IP, Forwarded) on a request while TRUST_PROXY is unset means the API is behind a proxy it does not trust: every user then arrives from the
 * proxy's own address, so the sign-in lock-out and the request throttle — both keyed by client IP — treat the whole organisation as ONE client (a few
 * mistyped passwords lock everybody out), and the sign-in history records the proxy instead of the person. The header is only a hint (anyone can send
 * it), so this logs a warning for an operator and changes nothing about how the request is handled.
 */
export function createProxyHeaderWarning(env: Record<string, string | undefined>, warn: (message: string) => void): RequestHandler {
  const trustsAProxy = resolveTrustProxy(env) !== false;
  let warned = false;
  return (req, _res, next) => {
    if (!warned && !trustsAProxy && (req.headers['x-forwarded-for'] !== undefined || req.headers['x-real-ip'] !== undefined || req.headers.forwarded !== undefined)) {
      warned = true;
      warn(
        'Requests carry a forwarded-address header (X-Forwarded-For / X-Real-IP / Forwarded) but TRUST_PROXY is not set: the API sees the reverse proxy as the only client, ' +
          'so the sign-in lock-out and the request rate limit apply to everybody together. Set TRUST_PROXY to the number of proxies in front of the API (for example 1) — see docs/OPERATIONS.md.',
      );
    }
    next();
  };
}
