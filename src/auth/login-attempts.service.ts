import { HttpException, HttpStatus, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../redis/redis.service';
import { SECONDS_PER_MINUTE, MS_PER_SECOND } from '../common/constants/time.constants';
import { HASH_ALGORITHM, HEX_ENCODING } from '../common/constants/crypto.constants';

interface CounterState {
  count: number;
  /** Seconds left in the window. */
  ttlSeconds: number;
}

/** What the lock-out says about an account / client IP right now. */
export interface LockState {
  locked: boolean;
  /** Seconds until the lock ends (0 when it is not locked). */
  retryAfterSeconds: number;
}

/** The lock-out thresholds in force. */
export interface LoginLockoutLimits {
  /** Failed attempts one account (one e-mail) may collect within a window before it is locked. */
  perAccount: number;
  /** Failed attempts one client IP may collect within a window before it is locked. */
  perIp: number;
  /** Length of the counting window, and so of the lock, in seconds. */
  windowSeconds: number;
}

const intFromEnv = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** The ONE place the lock-out limits are resolved: LOGIN_MAX_FAILED_PER_ACCOUNT (10), LOGIN_MAX_FAILED_PER_IP (20) and
 *  LOGIN_LOCK_MINUTES (15). Exported so that whatever REPORTS the rule (Settings > System > Security) reads the very
 *  numbers enforced below instead of repeating them. Read from the environment on every call, so a change takes effect
 *  without a rebuild. */
export function loginLockoutLimits(): LoginLockoutLimits {
  return {
    perAccount: intFromEnv('LOGIN_MAX_FAILED_PER_ACCOUNT', 10),
    perIp: intFromEnv('LOGIN_MAX_FAILED_PER_IP', 20),
    windowSeconds: intFromEnv('LOGIN_LOCK_MINUTES', 15) * SECONDS_PER_MINUTE,
  };
}

/**
 * Brute-force protection for sign-in, on top of the per-IP request throttle. It counts FAILED sign-ins
 * two ways — per account (the email, whichever IP the guesses come from, so a distributed attack on one
 * account is still stopped) and per client IP (so one machine cannot spray many accounts) — in a fixed
 * window that starts at the first failure. Once either counter reaches its limit, further attempts are
 * refused with 429 + Retry-After until the window ends, WITHOUT checking the password, so a correct
 * guess during the lock-out is not even confirmed.
 *
 * The count applies identically to emails that do not exist, so the lock-out response never reveals
 * whether an account is real. A successful sign-in clears that account's counter (not the IP's).
 *
 * The same counters also guard the CURRENT-password check of PATCH /auth/change-password
 * (AuthService.changePassword): a signed-in session — an unattended one, or a stolen token — must not be able to
 * guess the account's password there without ever meeting this lock-out. A wrong current password is counted exactly
 * like a failed sign-in (account + client IP), a locked account / IP is refused with the same 429 before the password
 * is looked at, and a correct one clears the account's counter. The key is the account's own e-mail, so the two entry
 * points share ONE budget of guesses per window instead of one each.
 *
 * Counters live in Redis when it is reachable (shared by every API instance, survives a restart) and in
 * process memory otherwise — a Redis outage degrades to per-instance counting instead of disabling the
 * protection. Tunable via LOGIN_MAX_FAILED_PER_ACCOUNT (10), LOGIN_MAX_FAILED_PER_IP (20) and
 * LOGIN_LOCK_MINUTES (15).
 */
@Injectable()
export class LoginAttemptsService {
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(@Optional() private readonly redis?: RedisService) {}

  private get limits(): LoginLockoutLimits {
    return loginLockoutLimits();
  }

  private accountKey(email: string): string {
    return `login:fail:acct:${createHash(HASH_ALGORITHM).update(email.trim().toLowerCase()).digest(HEX_ENCODING)}`;
  }

  private ipKey(ip: string): string {
    return `login:fail:ip:${ip}`;
  }

  /** Throws 429 when this account or this IP is currently locked. Call BEFORE verifying credentials. */
  async assertAllowed(email: string, ip: string | undefined): Promise<void> {
    const lock = await this.lockState(email, ip);
    if (lock.locked) throw this.blocked(lock.retryAfterSeconds);
  }

  /** Whether this account or this IP is locked right now, and for how long — the test assertAllowed throws on, for a
   *  caller that needs the state itself (for example to note that the failure it has just recorded tripped the lock). */
  async lockState(email: string, ip: string | undefined): Promise<LockState> {
    const { perAccount, perIp } = this.limits;
    const [account, client] = await Promise.all([
      this.read(this.accountKey(email)),
      ip ? this.read(this.ipKey(ip)) : Promise.resolve(null),
    ]);
    if (account && account.count >= perAccount) return { locked: true, retryAfterSeconds: account.ttlSeconds };
    if (client && client.count >= perIp) return { locked: true, retryAfterSeconds: client.ttlSeconds };
    return { locked: false, retryAfterSeconds: 0 };
  }

  /** Counts one failed sign-in (or one wrong current password on a password change) against the account and the client IP. */
  async recordFailure(email: string, ip: string | undefined): Promise<void> {
    await Promise.all([this.increment(this.accountKey(email)), ip ? this.increment(this.ipKey(ip)) : undefined]);
  }

  /** A successful sign-in (or a correct current password on a password change) forgives that account's earlier failures. */
  async recordSuccess(email: string): Promise<void> {
    const key = this.accountKey(email);
    this.memory.delete(key);
    await this.redis?.del(key);
  }

  private blocked(retryAfterSeconds: number): HttpException {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
    const minutes = Math.ceil(seconds / SECONDS_PER_MINUTE);
    return new HttpException(
      {
        message: `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        retryAfterSeconds: seconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async read(key: string): Promise<CounterState | null> {
    // The window is passed so a counter that lost its expiry (EXPIRE failed after INCR) is repaired on read —
    // a locked account records no further failures that could do it, and would otherwise stay locked forever.
    const fromRedis = (await this.redis?.counter(key, this.limits.windowSeconds)) ?? null;
    const fromMemory = this.readMemory(key);
    // Whichever store saw more failures wins (Redis may have been unreachable for part of the window).
    return [fromRedis, fromMemory].filter((state): state is CounterState => state !== null).sort((a, b) => b.count - a.count)[0] ?? null;
  }

  private async increment(key: string): Promise<void> {
    const shared = await this.redis?.incrementWithTtl(key, this.limits.windowSeconds);
    if (shared) return;
    const now = Date.now();
    const current = this.memory.get(key);
    if (current && current.resetAt > now) current.count += 1;
    else this.memory.set(key, { count: 1, resetAt: now + this.limits.windowSeconds * MS_PER_SECOND });
    if (this.memory.size > 5000) this.prune(now);
  }

  private readMemory(key: string): CounterState | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    const left = (entry.resetAt - Date.now()) / MS_PER_SECOND;
    if (left <= 0) {
      this.memory.delete(key);
      return null;
    }
    return { count: entry.count, ttlSeconds: left };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.memory) if (entry.resetAt <= now) this.memory.delete(key);
  }
}
