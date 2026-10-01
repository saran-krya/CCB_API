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

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
