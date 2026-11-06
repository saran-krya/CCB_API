import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { PrincipalType } from '../common/constants/auth.constants';
import { RedisService } from '../redis/redis.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { SESSION_LIVENESS_CACHE_TTL_SECONDS } from './session.constants';

const LIVE_MARKER = '1';

/**
 * Answers "is this session still signed in?" for JwtStrategy, on every authenticated request. A session is the
 * refresh-token family named by the access token's `sid`; it is live while at least one of its refresh tokens is
 * neither revoked nor expired (one indexed query on `family`). Signing out, revoking a device, "sign out others",
 * a password change, an admin revoke and a replayed refresh token all revoke the family's refresh tokens, so they
 * end the session's access token on its next request instead of when it would have expired.
 *
 * Only a LIVE answer is cached (Redis, a few seconds, shared by every API instance), and every revocation path
 * `forget`s the families it revokes, so the cache never keeps a revoked session alive. The cache can only make a
 * check cheaper: a miss, a Redis outage or a Redis error (RedisService swallows them) falls back to the database, and
 * a "not live" answer is never cached — a cache problem can neither reject a request nor let a revoked session in.
 * Redis is optional here, exactly as in LoginAttemptsService.
 */
@Injectable()
export class SessionLivenessService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @Optional()
    private readonly redis?: RedisService,
  ) {}

  private cacheKey(principalType: PrincipalType, userId: number, sid: string): string {
    return `session:live:${principalType}:${userId}:${sid}`;
  }

  async isLive(principalType: PrincipalType, userId: number, sid: string): Promise<boolean> {
    const key = this.cacheKey(principalType, userId, sid);
    if ((await this.redis?.get(key)) === LIVE_MARKER) return true;

    const live = await this.refreshTokens.findOne({
      select: { id: true },
      where: { principalType, userId, family: sid, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });
    if (!live) return false;

    await this.redis?.set(key, LIVE_MARKER, SESSION_LIVENESS_CACHE_TTL_SECONDS);
    return true;
  }

  /** Drops the cached "live" answers of sessions that were just revoked. */
  async forget(principalType: PrincipalType, userId: number, families: readonly string[]): Promise<void> {
    const redis = this.redis;
    if (!redis) return;
    await Promise.all(families.map((family) => redis.del(this.cacheKey(principalType, userId, family))));
  }
}
