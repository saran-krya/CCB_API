import { createHash, randomBytes } from 'crypto';

/**
 * The opaque-hash-at-rest token recipe already used for staff refresh tokens (see
 * AuthService.issueTokenPair/hashToken/parseExpiry in src/auth/auth.service.ts), extracted here so
 * it can be reused by other one-shot secure tokens (e.g. customer activation links) without
 * depending on AuthService, which is staff-auth-scoped. The raw token is returned to the caller
 * exactly once, at issuance — only its hash is ever persisted, so a database read alone can never
 * yield a usable token.
 */
export function generateSecureToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashSecureToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Parses strings like '24h' / '7d' / '30m' into an absolute expiry Date from now. */
export function parseExpiryDuration(expiry: string): Date {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiry format: ${expiry}`);
  const value = parseInt(match[1], 10);
  const ms: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return new Date(Date.now() + value * ms[match[2]]);
}
