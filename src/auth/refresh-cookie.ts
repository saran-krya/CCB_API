import type { Request, Response } from 'express';
import { RefreshCookieSettings } from '../config/runtime-config';

/** Header the web app sends on every call. Cookie-authenticated routes (refresh, logout) require it: a
 *  custom header cannot be set by a cross-site form or a "simple" cross-origin request, and sending it
 *  from another origin forces a CORS preflight that only an allow-listed origin passes — so a hostile
 *  page cannot ride the victim's refresh cookie. */
export const CLIENT_MARKER_HEADER = 'x-ccb-client';

/** Reads one cookie from the request without needing a cookie-parser middleware. */
export function readCookie(req: Pick<Request, 'headers'>, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim().replace(/^"|"$/g, '');
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function hasClientMarker(req: Pick<Request, 'headers'>): boolean {
  const value = req.headers[CLIENT_MARKER_HEADER];
  return typeof value === 'string' && value.trim() !== '';
}

/** Sets the HttpOnly refresh cookie. It is scoped to the auth routes (`path`), so the browser never
 *  attaches it to ordinary API calls.
 *
 *  `persistentForMs` is what "Remember me" decides. Given, the cookie is PERSISTENT: it carries a Max-Age of that many
 *  milliseconds (the lifetime of the refresh token it holds) and survives the browser being closed. Left out, the cookie
 *  is a SESSION cookie — no Max-Age, no Expires — which the browser drops when it closes. Either way the server's own
 *  expiry on the refresh token is the one that is enforced; the cookie's is only the browser's tidy-up. */
export function setRefreshCookie(
  res: Pick<Response, 'cookie'>,
  token: string,
  settings: RefreshCookieSettings,
  persistentForMs?: number,
): void {
  res.cookie(settings.name, token, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: settings.sameSite,
    path: settings.path,
    domain: settings.domain,
    ...(persistentForMs !== undefined ? { maxAge: persistentForMs } : {}),
  });
}

export function clearRefreshCookie(res: Pick<Response, 'clearCookie'>, settings: RefreshCookieSettings): void {
  res.clearCookie(settings.name, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: settings.sameSite,
    path: settings.path,
    domain: settings.domain,
  });
}
