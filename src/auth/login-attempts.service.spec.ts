import { HttpException } from '@nestjs/common';
import { LoginAttemptsService, loginLockoutLimits, lockoutKeys } from './login-attempts.service';
import type { RedisService } from '../redis/redis.service';
import type { KnownClientService } from './known-client.service';

/** An in-memory stand-in for the Redis counter API the lock-out uses (with real expiry, driven by the faked clock). */
class FakeRedis {
  store = new Map<string, { count: number; expiresAt: number }>();
  down = false;

  async incrementWithTtl(key: string, ttlSeconds: number) {
    if (this.down) return null;
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.store.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
      return { count: 1, ttlSeconds };
    }
    entry.count += 1;
    return { count: entry.count, ttlSeconds: Math.ceil((entry.expiresAt - now) / 1000) };
  }

  async counter(key: string) {
    if (this.down) return null;
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return { count: entry.count, ttlSeconds: Math.ceil((entry.expiresAt - Date.now()) / 1000) };
  }

  async deleteKeys(keys: string[]) {
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return removed;
  }

  async deleteByPrefix(prefix: string) {
    let removed = 0;
    for (const key of [...this.store.keys()]) if (key.startsWith(prefix) && this.store.delete(key)) removed += 1;
    return removed;
  }
}

const ENV = { LOGIN_MAX_FAILED_PER_ACCOUNT: '3', LOGIN_MAX_FAILED_PER_ACCOUNT_ANY_CLIENT: '6', LOGIN_MAX_FAILED_PER_IP: '5', LOGIN_LOCK_MINUTES: '1', LOGIN_KNOWN_CLIENT_DAYS: '30' };

describe('sign-in lock-out', () => {
  const saved: Record<string, string | undefined> = {};
  let knownIps: Set<string>;
  let knownClients: Pick<KnownClientService, 'hasSignedInFrom'>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    for (const [key, value] of Object.entries(ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    knownIps = new Set();
    knownClients = { hasSignedInFrom: jest.fn(async (_email: string, ip: string) => knownIps.has(ip)) };
  });

  afterEach(() => {
    jest.useRealTimers();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const build = (redis?: FakeRedis) => new LoginAttemptsService(redis as unknown as RedisService, knownClients as KnownClientService);
  const refused = async (service: LoginAttemptsService, email: string, ip: string | undefined, scope?: 'login' | 'mfa' | 'recovery') => {
    try {
      await service.assertAllowed(email, ip, scope);
      return false;
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      return true;
    }
  };
  const fail = async (service: LoginAttemptsService, email: string, ip: string, times: number) => {
    let last;
    for (let i = 0; i < times; i += 1) last = await service.recordFailure(email, ip);
    return last;
  };

  describe.each([
    ['Redis', () => build(new FakeRedis())],
    ['process memory (no Redis)', () => build(undefined)],
  ])('with %s', (_name, make) => {
    it('refuses one client for one account after the limit — and nobody else, so a stranger cannot lock the owner out', async () => {
      const service = make();
      await fail(service, 'admin@customer.example', '203.0.113.9', 3);

      expect(await refused(service, 'admin@customer.example', '203.0.113.9')).toBe(true);
      // The owner, from their own address, is not affected by what the stranger did.
      expect(await refused(service, 'admin@customer.example', '198.51.100.7')).toBe(false);
      // The stranger is not refused for a different account (only their own IP count, 3 < 5, applies).
      expect(await refused(service, 'someone.else@customer.example', '203.0.113.9')).toBe(false);
    });

    it('lifts the lock when the window ends', async () => {
      const service = make();
      await fail(service, 'a@b.example', '203.0.113.9', 3);
      expect(await refused(service, 'a@b.example', '203.0.113.9')).toBe(true);

      jest.advanceTimersByTime(61_000);
      expect(await refused(service, 'a@b.example', '203.0.113.9')).toBe(false);
    });

    it('locks a client IP for every account after the per-IP limit', async () => {
      const service = make();
      for (const email of ['one@x.example', 'two@x.example', 'three@x.example', 'four@x.example', 'five@x.example']) await service.recordFailure(email, '203.0.113.50');

      expect(await refused(service, 'brand.new@x.example', '203.0.113.50')).toBe(true);
      expect(await refused(service, 'brand.new@x.example', '203.0.113.51')).toBe(false);
    });

    it('puts an account under attack into protected mode: strangers refused, a client that signed in before still gets through', async () => {
      const service = make();
      knownIps.add('198.51.100.7');
      // Six failures from six different clients: no single client reaches its own limit, the account-wide limit (6) is reached.
      for (let i = 1; i <= 6; i += 1) await service.recordFailure('admin@customer.example', `203.0.113.${i}`);

      expect(await refused(service, 'admin@customer.example', '203.0.113.99')).toBe(true);
      expect(await refused(service, 'admin@customer.example', undefined)).toBe(true);
      expect(await refused(service, 'admin@customer.example', '198.51.100.7')).toBe(false);
      expect((await service.accountState('admin@customer.example')).locked).toBe(true);
      // Other accounts are untouched.
      expect(await refused(service, 'other@customer.example', '203.0.113.99')).toBe(false);
    });

    it('reports each threshold exactly once, on the failure that crosses it', async () => {
      const service = make();
      const outcomes = [];
      for (let i = 0; i < 4; i += 1) outcomes.push(await service.recordFailure('a@b.example', '203.0.113.9'));

      expect(outcomes.map((o) => o.clientLocked)).toEqual([false, false, true, false]);
      expect(outcomes.some((o) => o.accountProtected)).toBe(false);
    });

    it('a successful sign-in forgives the account, an administrator can unlock it, and the IP counter stays', async () => {
      const service = make();
      await fail(service, 'a@b.example', '203.0.113.9', 3);
      expect(await refused(service, 'a@b.example', '203.0.113.9')).toBe(true);

      await service.recordSuccess('a@b.example', '203.0.113.9');
      expect(await refused(service, 'a@b.example', '203.0.113.9')).toBe(false);

      // The IP's own count survives the success (3 so far): two more failures, against other accounts, reach the per-IP limit of 5 and lock the client.
      await service.recordFailure('other@b.example', '203.0.113.9');
      await service.recordFailure('another@b.example', '203.0.113.9');
      expect(await refused(service, 'a@b.example', '203.0.113.9')).toBe(true);

      // A second round from another client locks that client for the account; an administrator's unlock frees it again…
      await fail(service, 'a@b.example', '203.0.113.10', 3);
      expect(await refused(service, 'a@b.example', '203.0.113.10')).toBe(true);
      expect(await service.unlock('A@B.example')).toBeGreaterThan(0);
      expect(await refused(service, 'a@b.example', '203.0.113.10')).toBe(false);
      expect((await service.lockState('a@b.example', '203.0.113.10')).locked).toBe(false);
      // …but unlocking an ACCOUNT does not free a client IP that is itself locked: that is the guesser, not the account.
      expect(await refused(service, 'a@b.example', '203.0.113.9')).toBe(true);
    });

    it('unlockIp frees a locked client IP', async () => {
      const service = make();
      for (const email of ['1@x.example', '2@x.example', '3@x.example', '4@x.example', '5@x.example']) await service.recordFailure(email, '203.0.113.50');
      expect(await refused(service, 'z@x.example', '203.0.113.50')).toBe(true);

      expect(await service.unlockIp('203.0.113.50')).toBeGreaterThan(0);
      expect(await refused(service, 'z@x.example', '203.0.113.50')).toBe(false);
    });

    it('keeps the flows apart: wrong second-factor codes do not lock the sign-in, and vice versa', async () => {
      const service = make();
      for (let i = 0; i < 3; i += 1) await service.recordFailure('user:7', '203.0.113.9', 'mfa');

      expect(await refused(service, 'user:7', '203.0.113.9', 'mfa')).toBe(true);
      expect(await refused(service, 'user:7', '203.0.113.9', 'login')).toBe(false);
    });

    it('never lets protected mode through in a flow with no sign-in history (second factor)', async () => {
      const service = make();
      knownIps.add('198.51.100.7');
      for (let i = 1; i <= 6; i += 1) await service.recordFailure('user:7', `203.0.113.${i}`, 'mfa');

      expect(await refused(service, 'user:7', '198.51.100.7', 'mfa')).toBe(true);
    });

    it('treats a missing client address as one shared "unknown" client rather than skipping the check', async () => {
      const service = make();
      for (let i = 0; i < 3; i += 1) await service.recordFailure('a@b.example', undefined);
      expect(await refused(service, 'a@b.example', undefined)).toBe(true);
      expect(await refused(service, 'a@b.example', '198.51.100.7')).toBe(false);
    });
  });

  it('degrades to per-process counting when Redis goes away mid-window', async () => {
    const redis = new FakeRedis();
    const service = build(redis);
    await fail(service, 'a@b.example', '203.0.113.9', 2);
    redis.down = true;
    await service.recordFailure('a@b.example', '203.0.113.9');

    // Redis saw 2, process memory saw 1: the larger count wins, and the next failure from the Redis-less period still counts.
    expect(await refused(service, 'a@b.example', '203.0.113.9')).toBe(false);
    await fail(service, 'a@b.example', '203.0.113.9', 2);
    expect(await refused(service, 'a@b.example', '203.0.113.9')).toBe(true);
  });

  it('keeps the account-wide threshold above the per-client one, whatever the environment says', () => {
    process.env.LOGIN_MAX_FAILED_PER_ACCOUNT = '10';
    process.env.LOGIN_MAX_FAILED_PER_ACCOUNT_ANY_CLIENT = '4';
    expect(loginLockoutLimits().perAccountAnyClient).toBe(11);
  });

  it('derives the same counter keys the maintenance tool clears', () => {
    const keys = lockoutKeys(' Admin@Customer.EXAMPLE ');
    expect(keys.account).toMatch(/^login:fail:acct:[0-9a-f]{64}$/);
    expect(keys.pairPrefix).toBe(`login:fail:ac:${keys.account.split(':').pop()}:`);
    expect(lockoutKeys('admin@customer.example').account).toBe(keys.account);
    expect(lockoutKeys('admin@customer.example', 'mfa').account).toMatch(/^mfa:fail:acct:/);
  });
});
