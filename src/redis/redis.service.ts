import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';


@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      db: this.config.get<number>('REDIS_DB', 0),
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),

      enableOfflineQueue: false,
      lazyConnect: false,
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
    this.client.on('connect', () => {
      this.logger.log('Redis connected');
    });
  }

  /** Returns the cached string value, or null on a cache MISS or any Redis failure — a caller can't
   *  tell the two apart, which is correct: both mean "go to the database instead." */
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.error(`Redis GET failed for key "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  /** Stores `value` under `key` with a TTL in seconds. Swallows failures — a failed SET just means
   *  the next read is a MISS again, never an error the caller needs to handle. */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      this.logger.error(`Redis SET failed for key "${key}": ${(err as Error).message}`);
    }
  }

  /** Deletes one cache key (cache-aside invalidation after a write) — never a pattern/wildcard
   *  delete, so a mutation to one attribute can never accidentally clear unrelated cached keys. */
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.error(`Redis DEL failed for key "${key}": ${(err as Error).message}`);
    }
  }

  /** Deletes exactly these keys and returns how many existed. Failures are swallowed (0): like `del`, a cache or counter that cannot be cleared is
   *  simply cleared by its own expiry later. */
  async deleteKeys(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    try {
      return await this.client.del(...keys);
    } catch (err) {
      this.logger.error(`Redis DEL failed for ${keys.length} key(s): ${(err as Error).message}`);
      return 0;
    }
  }

  /** Deletes every key that starts with `prefix` (an iterating SCAN, never KEYS, so it does not block the server) and returns how many were
   *  removed, at most `maxKeys`. The ONLY caller builds the prefix from a hash of an account (the sign-in lock-out's per-client counters, which an
   *  administrator's "unlock" has to clear without knowing the clients) — it is not a general wildcard delete and must never be given a caller-supplied
   *  pattern. */
  async deleteByPrefix(prefix: string, maxKeys = 1000): Promise<number> {
    if (!prefix) return 0;
    try {
      let removed = 0;
      const stream = this.client.scanStream({ match: `${prefix}*`, count: 100 });
      for await (const keys of stream as AsyncIterable<string[]>) {
        if (keys.length > 0) removed += await this.client.del(...keys);
        if (removed >= maxKeys) break;
      }
      return removed;
    } catch (err) {
      this.logger.error(`Redis prefix delete failed for "${prefix}": ${(err as Error).message}`);
      return 0;
    }
  }

  /** Round-trips a PING to the server. Unlike every other method here it deliberately does NOT swallow a failure: its only
   *  caller is the System Health check, which must report "down" truthfully instead of treating an outage as a cache miss. */
  async ping(): Promise<void> {
    await this.client.ping();
  }

  /** Atomically adds one to a counter, starting its TTL (seconds) on the first increment so the window
   *  is fixed from the first event. Returns the new count and the seconds left in the window, or null
   *  when Redis is unavailable — the caller then falls back to its own in-process counter, so a Redis
   *  outage never blocks (or silently disables) the feature that uses it. */
  async incrementWithTtl(key: string, ttlSeconds: number): Promise<{ count: number; ttlSeconds: number } | null> {
    try {
      const count = await this.client.incr(key);
      // A key with no expiry (-1) would count — and block — forever, so the TTL is (re)applied whenever it
      // is missing: on the first increment, and again if a crash ever lost it between the two calls.
      // Plain EXPIRE (no NX) keeps this working on every Redis version.
      let ttl = await this.client.ttl(key);
      if (ttl < 0) {
        await this.client.expire(key, ttlSeconds);
        ttl = ttlSeconds;
      }
      return { count, ttlSeconds: ttl };
    } catch (err) {
      this.logger.error(`Redis INCR failed for key "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  /** Current counter value and remaining window, or null (absent key or Redis unavailable).
   *
   *  A counter that exists WITHOUT an expiry (TTL -1 — the connection dropped between INCR and EXPIRE) would
   *  block its subject forever, and a blocked subject records no further failures that could repair it.
   *  So when the caller passes the window (`repairTtlSeconds`), a missing expiry is applied right here, on
   *  the read: the lock then ends one window from now instead of never. */
  async counter(key: string, repairTtlSeconds?: number): Promise<{ count: number; ttlSeconds: number } | null> {
    try {
      const [count, ttl] = await Promise.all([this.client.get(key), this.client.ttl(key)]);
      if (count === null) return null;
      if (ttl === -1 && repairTtlSeconds !== undefined) {
        await this.client.expire(key, repairTtlSeconds);
        return { count: Number(count), ttlSeconds: repairTtlSeconds };
      }
      return { count: Number(count), ttlSeconds: ttl > 0 ? ttl : 0 };
    } catch (err) {
      this.logger.error(`Redis counter read failed for key "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
