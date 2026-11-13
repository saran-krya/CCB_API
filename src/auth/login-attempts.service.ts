import { HttpException, HttpStatus, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../redis/redis.service';
import { KnownClientLookup, KnownClientService } from './known-client.service';
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
  /** Failed attempts ONE client (one IP address) may collect against ONE account within a window before that client is refused for that account. */
  perAccount: number;
  /** Failed attempts one account may collect from ALL clients together before it goes into protected mode: only a client that has signed in to it
   *  recently may still try, a stranger is refused. Always larger than `perAccount`. */
  perAccountAnyClient: number;
  /** Failed attempts one client IP may collect (against any accounts) within a window before it is locked. */
  perIp: number;
  /** Length of the counting window, and so of the lock, in seconds. */
  windowSeconds: number;
  /** How many days back a successful sign-in makes a client IP "known" to an account (protected mode lets known clients through). */
  knownClientDays: number;
}

/** The flows that have their own counters (a wrong password, a wrong second-factor code, a wrong recovery attempt each count separately). */
export type LockoutScope = 'login' | 'mfa' | 'recovery';
export const LOCKOUT_SCOPES: readonly LockoutScope[] = ['login', 'mfa', 'recovery'];

/** What one recorded failure did: each flag is true only for the failure that CROSSED its threshold, so it can be reported (audited) exactly once. */
export interface FailureOutcome {
  /** This client is now refused for this account. */
  clientLocked: boolean;
  /** The account just went into protected mode (too many failures from too many clients). */
  accountProtected: boolean;
  /** This client IP is now locked for every account. */
  ipLocked: boolean;
}

const intFromEnv = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The ONE place the lock-out limits are resolved: LOGIN_MAX_FAILED_PER_ACCOUNT (10, per client), LOGIN_MAX_FAILED_PER_ACCOUNT_ANY_CLIENT (50),
 *  LOGIN_MAX_FAILED_PER_IP (20), LOGIN_LOCK_MINUTES (15) and LOGIN_KNOWN_CLIENT_DAYS (30). Exported so that whatever REPORTS the rule (Settings >
 *  Security) reads the very numbers enforced below instead of repeating them. Read from the environment on every call, so a change takes effect
 *  without a rebuild. */
export function loginLockoutLimits(): LoginLockoutLimits {
  const perAccount = intFromEnv('LOGIN_MAX_FAILED_PER_ACCOUNT', 10);
  return {
    perAccount,
    // Never at or below the per-client limit: the account-wide threshold is the "many clients" safety net, not a stricter per-client rule.
    perAccountAnyClient: Math.max(intFromEnv('LOGIN_MAX_FAILED_PER_ACCOUNT_ANY_CLIENT', 50), perAccount + 1),
    perIp: intFromEnv('LOGIN_MAX_FAILED_PER_IP', 20),
    windowSeconds: intFromEnv('LOGIN_LOCK_MINUTES', 15) * SECONDS_PER_MINUTE,
    knownClientDays: intFromEnv('LOGIN_KNOWN_CLIENT_DAYS', 30),
  };
}

const sha = (value: string): string => createHash(HASH_ALGORITHM).update(value).digest(HEX_ENCODING);
const subjectHash = (subject: string): string => sha(subject.trim().toLowerCase());
const clientHash = (ip: string | undefined): string => sha(ip ?? 'unknown').slice(0, 24);
const scopePrefix = (scope: LockoutScope): string => (scope === 'login' ? 'login' : scope);

/** The counter keys of one account (the sign-in lock-out of "a@b.c" and the second-factor lock-out of the same account are separate). Shared with the
 *  server maintenance tool (scripts/maintenance/unlock-signin.ts), which clears them from outside the application. */
export function lockoutKeys(subject: string, scope: LockoutScope = 'login'): { account: string; pairPrefix: string } {
  const prefix = scopePrefix(scope);
  const hash = subjectHash(subject);
  return { account: `${prefix}:fail:acct:${hash}`, pairPrefix: `${prefix}:fail:ac:${hash}:` };
}

/** The counter key of one client IP (all accounts together). */
export function lockoutIpKey(ip: string, scope: LockoutScope = 'login'): string {
  return `${scopePrefix(scope)}:fail:ip:${ip}`;
}

/**
 * Brute-force protection for sign-in, on top of the per-IP request throttle. It counts FAILED attempts in fixed windows that start at the first
 * failure, three ways:
 *
 *   1. per ACCOUNT AND CLIENT — one client (IP address) guessing one account. At the limit that client is refused for that account until the window
 *      ends. Another client — in particular the account's owner — is not affected, so a stranger cannot lock the owner out by failing on purpose.
 *   2. per CLIENT IP — one machine spraying many accounts. At the limit that IP is refused for every account.
 *   3. per ACCOUNT, all clients together — a guessing attack spread over many addresses. At the (much higher) limit the account goes into PROTECTED
 *      mode: a client that has signed in to it within the last LOGIN_KNOWN_CLIENT_DAYS still gets through (it is still subject to 1 and 2), anyone
 *      else is refused until the window ends. The owner, signing in from where they always do, keeps working.
 *
 * A refused attempt is answered with 429 + Retry-After BEFORE the password is checked, so a correct guess during a lock is not even confirmed. The
 * counts apply identically to e-mails that do not exist, so the lock-out never reveals whether an account is real. A successful sign-in clears the
 * account's counters (not the IP's). An administrator can clear an account explicitly (`unlock`; also the maintenance tool) — the lock was never
 * meant to be a way to take an administrator out of service.
 *
 * The same counters guard the CURRENT-password check of PATCH /auth/change-password, and (scope 'mfa' / 'recovery') the second-factor and
 * password-recovery steps, each with its own counters.
 *
 * Counters live in Redis when it is reachable (shared by every API instance, survives a restart) and in process memory otherwise — a Redis outage
 * degrades to per-instance counting instead of disabling the protection.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly knownClients?: KnownClientService,
  ) {}

  private get limits(): LoginLockoutLimits {
    return loginLockoutLimits();
  }

  private pairKey(subject: string, ip: string | undefined, scope: LockoutScope): string {
    return `${lockoutKeys(subject, scope).pairPrefix}${clientHash(ip)}`;
  }

  /** Throws 429 when this client is locked out of this account, or this IP is locked, or the account is protected against this client. Call BEFORE
   *  verifying credentials. */
  async assertAllowed(subject: string, ip: string | undefined, scope: LockoutScope = 'login'): Promise<void> {
    const lock = await this.lockState(subject, ip, scope);
    if (lock.locked) throw this.blocked(lock.retryAfterSeconds);
  }

  /** Whether this client may try this account right now, and for how long it may not — the test assertAllowed throws on, for a caller that needs the
   *  state itself (for example to note that the failure it has just recorded tripped the lock). */
  async lockState(subject: string, ip: string | undefined, scope: LockoutScope = 'login'): Promise<LockState> {
    const { perAccount, perAccountAnyClient, perIp } = this.limits;
    const [pair, account, client] = await Promise.all([
      this.read(this.pairKey(subject, ip, scope)),
      this.read(lockoutKeys(subject, scope).account),
      ip ? this.read(lockoutIpKey(ip, scope)) : Promise.resolve(null),
    ]);
    if (pair && pair.count >= perAccount) return { locked: true, retryAfterSeconds: pair.ttlSeconds };
    if (client && client.count >= perIp) return { locked: true, retryAfterSeconds: client.ttlSeconds };
    if (account && account.count >= perAccountAnyClient && !(await this.isKnownClient(subject, ip, scope))) {
      return { locked: true, retryAfterSeconds: account.ttlSeconds };
    }
    return { locked: false, retryAfterSeconds: 0 };
  }

  /** Where the ACCOUNT stands regardless of which client asks: locked here means "in protected mode" (too many failures from too many clients).
   *  What an administrator's Manage sign-in access screen shows; one client being locked out of the account is not the account's state. */
  async accountState(subject: string, scope: LockoutScope = 'login'): Promise<LockState> {
    const account = await this.read(lockoutKeys(subject, scope).account);
    if (account && account.count >= this.limits.perAccountAnyClient) return { locked: true, retryAfterSeconds: account.ttlSeconds };
    return { locked: false, retryAfterSeconds: 0 };
  }

  /** Counts one failed attempt against the account, the client and the account-and-client pair. */
  async recordFailure(subject: string, ip: string | undefined, scope: LockoutScope = 'login'): Promise<FailureOutcome> {
    const { perAccount, perAccountAnyClient, perIp } = this.limits;
    const [pair, account, client] = await Promise.all([
      this.increment(this.pairKey(subject, ip, scope)),
      this.increment(lockoutKeys(subject, scope).account),
      ip ? this.increment(lockoutIpKey(ip, scope)) : Promise.resolve(0),
    ]);
    return { clientLocked: pair === perAccount, accountProtected: account === perAccountAnyClient, ipLocked: !!ip && client === perIp };
  }

  /** A successful attempt forgives that account's earlier failures (this client's and the account-wide count); the IP's own count stays. */
  async recordSuccess(subject: string, ip?: string, scope: LockoutScope = 'login'): Promise<void> {
    const { account, pairPrefix } = lockoutKeys(subject, scope);
    this.memory.delete(account);
    await this.redis?.deleteKeys([account]);
    if (ip !== undefined) {
      const pair = this.pairKey(subject, ip, scope);
      this.memory.delete(pair);
      await this.redis?.deleteKeys([pair]);
    } else {
      this.deleteMemory((key) => key.startsWith(pairPrefix));
      await this.redis?.deleteByPrefix(pairPrefix);
    }
  }

  /** Clears every counter of one account (all clients, all flows unless `scope` is given): the administrator's "unlock". Returns how many counters
   *  were cleared. The IP counters are not touched — see unlockIp. Counters held in the memory of ANOTHER process cannot be reached from here. */
  async unlock(subject: string, scope: LockoutScope | 'all' = 'all'): Promise<number> {
    let cleared = 0;
    for (const s of scope === 'all' ? LOCKOUT_SCOPES : [scope]) {
      const { account, pairPrefix } = lockoutKeys(subject, s);
      cleared += this.deleteMemory((key) => key === account || key.startsWith(pairPrefix));
      cleared += (await this.redis?.deleteKeys([account])) ?? 0;
      cleared += (await this.redis?.deleteByPrefix(pairPrefix)) ?? 0;
    }
    return cleared;
  }

  /** Clears the counters of one client IP (every flow). */
  async unlockIp(ip: string): Promise<number> {
    let cleared = 0;
    for (const s of LOCKOUT_SCOPES) {
      const key = lockoutIpKey(ip, s);
      cleared += this.deleteMemory((candidate) => candidate === key);
      cleared += (await this.redis?.deleteKeys([key])) ?? 0;
    }
    return cleared;
  }

  private async isKnownClient(subject: string, ip: string | undefined, scope: LockoutScope): Promise<boolean> {
    // Only the sign-in flow has a history of "who has signed in from where"; a second-factor or recovery step has no such notion and stays locked.
    if (scope !== 'login' || !ip || !this.knownClients) return false;
    const lookup: KnownClientLookup = this.knownClients;
    const since = new Date(Date.now() - this.limits.knownClientDays * DAY_MS);
    return lookup.hasSignedInFrom(subject, ip, since);
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

  /** Adds one to the counter and returns the new count. */
  private async increment(key: string): Promise<number> {
    const shared = await this.redis?.incrementWithTtl(key, this.limits.windowSeconds);
    if (shared) return shared.count;
    const now = Date.now();
    const current = this.memory.get(key);
    let count: number;
    if (current && current.resetAt > now) {
      current.count += 1;
      count = current.count;
    } else {
      this.memory.set(key, { count: 1, resetAt: now + this.limits.windowSeconds * MS_PER_SECOND });
      count = 1;
    }
    if (this.memory.size > 5000) this.prune(now);
    return count;
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

  private deleteMemory(matches: (key: string) => boolean): number {
    let removed = 0;
    for (const key of [...this.memory.keys()]) {
      if (matches(key)) {
        this.memory.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.memory) if (entry.resetAt <= now) this.memory.delete(key);
  }
}
