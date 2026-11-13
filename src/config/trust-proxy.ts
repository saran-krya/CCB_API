import { isIP } from 'net';

/**
 * TRUST_PROXY — how many reverse-proxy hops Express may believe `X-Forwarded-For` from. Getting it wrong has two opposite failure modes, so the value is
 * checked at start-up instead of being handed to Express as typed:
 *
 *   - unset behind a proxy: every client looks like the proxy's address, so the sign-in lock-out and the request throttle (both keyed by client IP)
 *     treat the whole organisation as ONE client;
 *   - "true" (trust everything): any client can send its own X-Forwarded-For and pick the address it is rate-limited and locked out under.
 *
 * Valid: empty / "false" (trust nobody, the default), a hop count ("1"), Express's own names (loopback, linklocal, uniquelocal), or a comma-separated
 * list of IP addresses / CIDR ranges ("10.0.0.0/8, 192.168.1.5"). Anything else — notably "true" — is refused.
 */
const NAMED = new Set(['loopback', 'linklocal', 'uniquelocal']);

const isAddressOrRange = (token: string): boolean => {
  const [address, prefix, ...rest] = token.split('/');
  if (rest.length > 0) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
};

/** True when `raw` (the trimmed TRUST_PROXY value) is one of the accepted forms. */
export function isTrustProxyValue(raw: string): boolean {
  const value = raw.trim();
  if (value === '' || value.toLowerCase() === 'false') return true;
  if (/^\d+$/.test(value)) return Number(value) > 0 && Number(value) <= 32;
  const tokens = value.split(',').map((token) => token.trim()).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => NAMED.has(token.toLowerCase()) || isAddressOrRange(token));
}
