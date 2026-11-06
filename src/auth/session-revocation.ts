import { EntityManager } from 'typeorm';
import { PrincipalType } from '../common/constants/auth.constants';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserDevice } from './entities/user-device.entity';
import { UserLoginHistory } from './entities/user-login-history.entity';

/**
 * The ONE implementation of "end sessions": every sign-out, revoke and admin action in AuthService, and the user
 * removal / deactivation in UserService, go through it, so a revoked session is never left half-ended (tokens revoked
 * but the device still listed, or the history row still open).
 *
 * A plain module over an `EntityManager` (not a Nest provider) on purpose: AuthService depends on UserService, so
 * UserService cannot depend on AuthService, and a function that takes the caller's manager also joins the caller's
 * own transaction (UserService revokes inside the transaction that removes or deactivates the account).
 *
 * The raw SQL is MySQL (`NOT IN` over a NULL-free subquery, `NOT EXISTS`), like the rest of this module.
 */

/** Which sessions (refresh-token families) an operation applies to; no field means all of the principal's sessions. */
export interface SessionScope {
  /** Only these sessions. */
  only?: readonly string[];
  /** Every session except these (the caller's own, for "sign out the others"). */
  except?: readonly string[];
}

/** The sessions in `scope` that are live right now (an unrevoked, unexpired refresh token exists). */
export async function findLiveFamilies(
  manager: EntityManager,
  principalType: PrincipalType,
  userId: number,
  scope: SessionScope = {},
  now: Date = new Date(),
): Promise<string[]> {
  if (scope.only && scope.only.length === 0) return [];

  const query = manager
    .createQueryBuilder(RefreshToken, 'rt')
    .select('rt.family', 'family')
    .distinct(true)
    .where('rt.user_id = :userId AND rt.principal_type = :principalType AND rt.revoked_at IS NULL AND rt.expires_at > :now', {
      userId,
      principalType,
      now,
    });
  if (scope.only) query.andWhere('rt.family IN (:...only)', { only: scope.only });
  if (scope.except?.length) query.andWhere('rt.family NOT IN (:...except)', { except: scope.except });

  const rows = await query.getRawMany<{ family: string }>();
  return rows.map((row) => row.family);
}

/**
 * Revokes the principal's refresh tokens in `scope`, then closes whatever that left without a live session: a device
 * with no live refresh token is deactivated, and a login-history row that was never closed gets its sign-out time.
 * Idempotent, and also tidies sessions that had merely lapsed.
 *
 * A session is "gone" the moment its refresh tokens are revoked: the access token it signed (carrying `sid`) is refused
 * by JwtStrategy on its next request, not when it would have expired.
 */
export async function revokeUserSessions(
  manager: EntityManager,
  principalType: PrincipalType,
  userId: number,
  scope: SessionScope = {},
  now: Date = new Date(),
): Promise<void> {
  if (!scope.only || scope.only.length > 0) {
    const revoke = manager
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: now })
      .where('user_id = :userId AND principal_type = :principalType AND revoked_at IS NULL', { userId, principalType });
    if (scope.only) revoke.andWhere('family IN (:...only)', { only: scope.only });
    if (scope.except?.length) revoke.andWhere('family NOT IN (:...except)', { except: scope.except });
    await revoke.execute();
  }

  await closeEndedSessions(manager, principalType, userId, now);
}

/** Deactivates the principal's devices, and closes their login-history rows, that no longer have a live refresh token.
 *  Rows that belong to sessions without a device (`device_id IS NULL`) are closed only when no such session is live. */
async function closeEndedSessions(manager: EntityManager, principalType: PrincipalType, userId: number, now: Date): Promise<void> {
  const liveDevices =
    'SELECT rt.device_id FROM refresh_tokens rt WHERE rt.principal_type = :principalType AND rt.user_id = :userId ' +
    'AND rt.device_id IS NOT NULL AND rt.revoked_at IS NULL AND rt.expires_at > :now';
  const liveWithoutDevice =
    'SELECT 1 FROM refresh_tokens rt WHERE rt.principal_type = :principalType AND rt.user_id = :userId ' +
    'AND rt.device_id IS NULL AND rt.revoked_at IS NULL AND rt.expires_at > :now';
  const params = { principalType, userId, now };

  await manager
    .createQueryBuilder()
    .update(UserDevice)
    .set({ isActive: false })
    .where('principal_type = :principalType AND user_id = :userId AND is_active = 1', params)
    .andWhere(`device_id NOT IN (${liveDevices})`, params)
    .execute();

  await manager
    .createQueryBuilder()
    .update(UserLoginHistory)
    .set({ logoutAt: now })
    .where('principal_type = :principalType AND user_id = :userId AND logout_at IS NULL', params)
    .andWhere(
      `((device_id IS NOT NULL AND device_id NOT IN (${liveDevices})) OR (device_id IS NULL AND NOT EXISTS (${liveWithoutDevice})))`,
      params,
    )
    .execute();
}
