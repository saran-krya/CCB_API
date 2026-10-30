import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ROLES } from '@app/common/constants/global';
import { UserRole } from './entities/user-role.entity';
import { Role } from '../role/entities/role.entity';
import { AuditService } from '../../audit/audit.service';

// Same MySQL duplicate-key idiom MeterService/IngestionService use for their own unique-index races.
const isDuplicateKeyError = (err: unknown): boolean =>
  /duplicate entry/i.test(err instanceof Error ? err.message : '') || (err as { code?: string })?.code === 'ER_DUP_ENTRY';

/**
 * The SINGLE source of truth for "which roles does this user hold" — `users.role_id` no longer
 * exists (removed per the user_roles migration; see UserRole entity's own doc comment). Every
 * consumer that used to read `user.role`/`user.roleId` directly goes through this service instead,
 * including the non-RBAC business lookups (Field Inspection eligibility, Reporting Manager/Field
 * Inspector pickers, the Users dashboard) that were migrated alongside the RBAC path.
 *
 * A user holds one or more roles, ordered by `id ASC` (assignment order). The first is the PRIMARY
 * role — what `getPrimaryRoleId`/`getPrimaryRole` return, kept only for the signed JWT payload and
 * the legacy singular `role` fields. Anything that DECIDES access must use the whole set instead
 * (`getRoleIds`/`getRolesForUser`): effective permissions are the union over every role, and the set
 * must be re-read from here on every request, never trusted from a token (see JwtStrategy.validate).
 *
 * Writes are `addRolesToUser` (additive, idempotent) and `removeRoleFromUser` (one role at a time,
 * with the lock-out and privilege rules enforced under row locks). There is deliberately no "replace
 * all of a user's roles" operation — a replace would silently drop roles that were granted elsewhere.
 */
@Injectable()
export class UserRoleService {
  constructor(
    @InjectRepository(UserRole)
    private readonly userRoles: Repository<UserRole>,

    private readonly audit: AuditService,
  ) {}

  async getPrimaryRoleId(userId: number): Promise<number | null> {
    const row = await this.userRoles.findOne({ where: { userId }, order: { id: 'ASC' } });
    return row?.roleId ?? null;
  }

  /** Resolves BOTH `roleId` and `roleName` of the PRIMARY role in one query (joins Role) — this is
   *  what AuthService's JWT-issuing login()/refresh() call, since the signed payload needs both (and
   *  carries the primary role only). Returns null if the user has no role row at all (should not
   *  happen for any active staff account, but handled explicitly rather than assumed — see the call
   *  sites' own null-check). */
  async getPrimaryRole(userId: number): Promise<{ roleId: number; roleName: string } | null> {
    const row = await this.userRoles.findOne({ where: { userId }, order: { id: 'ASC' }, relations: { role: true } });
    if (!row) return null;
    return { roleId: row.roleId, roleName: row.role.roleName };
  }

  /** Every role id this user holds, in assignment order — the set authorization decisions use. */
  async getRoleIds(userId: number): Promise<number[]> {
    const rows = await this.userRoles.find({ where: { userId }, order: { id: 'ASC' } });
    return rows.map((r) => r.roleId);
  }

  /** Full Role entities for a user, ordered the same deterministic way as getPrimaryRole/getRoleIds
   *  (so the first is the primary). Replaces the old `user.role` eager relation for call sites that
   *  need the whole Role object (e.g. a detail-screen response), not just the id/name pair
   *  getPrimaryRole returns. */
  async getRolesForUser(userId: number): Promise<Role[]> {
    const rows = await this.userRoles.find({ where: { userId }, order: { id: 'ASC' }, relations: { role: true } });
    // A role soft-deleted after it was assigned joins to null. It grants nothing, and this feeds the
    // principal JwtStrategy builds on every request — skipping it keeps one stale row from turning
    // every request by that user into a TypeError.
    return rows.map((r) => r.role).filter((role): role is Role => !!role);
  }

  /** The batched equivalent of getRolesForUser — for the Users list, which needs every row's roles
   *  across a whole page in one query instead of one per row (N+1). Keyed by user id; each list is in
   *  assignment order (first = primary), a user with no assignment is simply absent. Deliberately a
   *  plain join rather than `relations: { role: true }`: that would also pull each role's eager
   *  `userCategory`, which the list never showed. */
  async getRolesForUsers(userIds: number[]): Promise<Map<number, Role[]>> {
    const rolesByUser = new Map<number, Role[]>();
    if (userIds.length === 0) return rolesByUser;

    const rows = await this.userRoles
      .createQueryBuilder('ur')
      .innerJoinAndSelect('ur.role', 'role')
      .where('ur.userId IN (:...userIds)', { userIds })
      .orderBy('ur.id', 'ASC')
      .getMany();

    for (const row of rows) {
      const roles = rolesByUser.get(row.userId);
      if (roles) roles.push(row.role);
      else rolesByUser.set(row.userId, [row.role]);
    }
    return rolesByUser;
  }

  /** Single-user capability check — does ANY role this user holds have `capability` set? Written
   *  against `getRoleIds`, so a secondary role counts exactly like the primary one. */
  async hasRoleCapability(userId: number, capability: 'canBeReportingManager' | 'canBeFieldInspector'): Promise<boolean> {
    const roleIds = await this.getRoleIds(userId);
    if (roleIds.length === 0) return false;
    const count = await this.userRoles.manager
      .createQueryBuilder(Role, 'role')
      .where('role.id IN (:...roleIds)', { roleIds })
      .andWhere(`role.${capability} = :flag`, { flag: true })
      .getCount();
    return count > 0;
  }

  /** The batched equivalent of hasRoleCapability — for list endpoints (Reporting Manager picker,
   *  Field Inspector picker, Users dashboard) that need "every active user whose role has this
   *  capability", in one join query instead of one hasRoleCapability call per user (N+1). Returns
   *  one row per (user, role) pair, so a user holding several qualifying roles appears once per role,
   *  in assignment order (`user_roles.id ASC`) — callers that want one entry per user keep the first. */
  async getUsersByRoleCapability(
    capability: 'canBeReportingManager' | 'canBeFieldInspector',
  ): Promise<Array<{ userId: number; roleId: number; roleName: string }>> {
    const rows = await this.userRoles
      .createQueryBuilder('ur')
      .innerJoin(Role, 'role', 'role.id = ur.roleId')
      .where(`role.${capability} = :flag`, { flag: true })
      .select('ur.userId', 'userId')
      .addSelect('ur.roleId', 'roleId')
      .addSelect('role.roleName', 'roleName')
      .orderBy('ur.id', 'ASC')
      .getRawMany();
    return rows.map((r) => ({ userId: Number(r.userId), roleId: Number(r.roleId), roleName: r.roleName }));
  }

  /** Every user currently holding a specific roleId — the reverse of getRoleIds (which resolves a
   *  user's roles; this resolves a role's users). Used by WorkflowSlaSchedulerService to find who to
   *  notify when a workflow level's configured approver role breaches its SLA. */
  async getUsersByRoleId(roleId: number): Promise<Array<{ userId: number }>> {
    const rows = await this.userRoles.find({ where: { roleId }, select: ['userId'] });
    return rows.map((r) => ({ userId: r.userId }));
  }

  /** The batched equivalent of `getUsersByRoleId().length` — for the Roles list screen, which needs
   *  an "assigned users" count per role across a whole page of roles in one query, not one count
   *  query per row (N+1). A role with zero assigned users is simply absent from the result map —
   *  callers default to 0 via `?? 0`, never treat a missing entry as an error. */
  async getUserCountsByRoleIds(roleIds: number[]): Promise<Map<number, number>> {
    if (roleIds.length === 0) return new Map();
    const rows = await this.userRoles
      .createQueryBuilder('ur')
      .where('ur.roleId IN (:...roleIds)', { roleIds })
      .select('ur.roleId', 'roleId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ur.roleId')
      .getRawMany();
    return new Map(rows.map((r) => [Number(r.roleId), Number(r.count)]));
  }

  /** Grants `roleIds` to `userId` — ADDITIVE and idempotent: ids the user already holds are skipped
   *  (never an error, never an update), nothing is ever removed, and the ids actually granted are
   *  returned in grant order. A request that changes nothing writes nothing — no insert, no audit row.
   *  Callers validate that every role exists (a 404) beforehand; the FK is only the backstop.
   *
   *  `manager` is the caller's own open transaction (UserService.create, BootstrapService's seed), so
   *  the grant and its audit row commit or roll back together with the caller's User row. Without one,
   *  this opens its own, so a multi-role grant and its single ASSIGN_ROLE audit row are atomic either
   *  way. `actorId` is omitted by boot-time seeding — that still produces an audit row (performedBy:
   *  null), consistent with every other service here (see AuditService.record's own fallback).
   *
   *  The self-change rule is enforced HERE, not by the caller, because "does this request change
   *  anything" can only be decided against the rows read inside this transaction: an actor may not
   *  grant roles to their OWN user (self-escalation with no second party accountable for it), yet a
   *  request that adds nothing is a no-op and stays allowed. Granting can only grow the set, so unlike
   *  removal it needs no row locks: the unique (user_id, role_id) key already makes a duplicate grant
   *  impossible. A locking read here would also be harmful — over a brand-new user's still-empty
   *  range (UserService.create) it only takes a gap lock, and two concurrent creations would then
   *  deadlock on each other's gap lock when both insert. */
  async addRolesToUser(userId: number, roleIds: number[], manager?: EntityManager, actorId?: number): Promise<number[]> {
    const requested = [...new Set(roleIds)];
    if (requested.length === 0) return [];

    return this.inTransaction(manager, async (tx) => {
      const repo = tx.getRepository(UserRole);
      const heldRoleIds = (await repo.find({ where: { userId }, order: { id: 'ASC' } })).map((row) => row.roleId);
      const missing = requested.filter((roleId) => !heldRoleIds.includes(roleId));
      if (missing.length === 0) return [];

      if (actorId === userId) {
        throw new ForbiddenException('You cannot change your own roles.');
      }

      const added: number[] = [];
      for (const roleId of missing) {
        try {
          await repo.save(repo.create({ userId, roleId }));
          added.push(roleId);
        } catch (err) {
          // An identical grant committed between the read above and this insert (a double-submit):
          // the role IS held now, which is all idempotency promises — it is just not ours to report.
          if (!isDuplicateKeyError(err)) throw err;
        }
      }
      if (added.length === 0) return [];

      await this.audit.record(
        {
          moduleName: 'user_roles',
          entityId: userId,
          action: 'ASSIGN_ROLE',
          oldValue: { roleIds: heldRoleIds },
          newValue: { roleIds: [...heldRoleIds, ...added] },
          performedBy: actorId,
        },
        tx,
      );
      return added;
    });
  }

  /** Revokes ONE role from a user — idempotent: a role the user does not hold is a no-op (returns
   *  false, writes nothing). Returns true when a row was removed. The row is HARD-deleted, never
   *  soft-deleted: the unique key is (user_id, role_id) without `deleted_at`, so a soft-deleted row
   *  would keep that pair occupied and block re-granting the role.
   *
   *  Three rules, all ForbiddenException, all evaluated inside THIS transaction against rows locked
   *  with pessimistic_write (a check made before the transaction could be invalidated by a concurrent
   *  change before the delete lands), in this order:
   *    1. No self-change — an actor cannot revoke roles from their own user; role changes must be
   *       made by someone else so a second party is always accountable. A no-op is still allowed.
   *    2. Last role — a user must keep at least one. Login and JwtStrategy both reject a role-less
   *       user, so removing the last role is an instant lock-out of that account.
   *    3. Last SUPER_ADMIN — the role RolesGuard bypasses on and the bootstrap grant reconciliation
   *       keys on must always keep at least one holder, or every admin-only surface (including
   *       user/role management itself) is left with no one able to grant it back. "Holder" counts
   *       role-assignment rows, exactly as the old reassign guard did.
   *
   *  Lock order: the SUPER_ADMIN holders' rows (only when revoking SUPER_ADMIN) are locked BEFORE the
   *  user's own rows. Two admins demoting each other's SUPER_ADMIN at the same moment then queue up on
   *  that shared lock and the second one reads the first one's committed result — and is refused —
   *  instead of each holding the other's row and deadlocking. The locks are held to commit, so two
   *  concurrent removals can never both pass the last-SUPER_ADMIN check. */
  async removeRoleFromUser(userId: number, roleId: number, manager?: EntityManager, actorId?: number): Promise<boolean> {
    return this.inTransaction(manager, async (tx) => {
      const repo = tx.getRepository(UserRole);

      const role = await tx.getRepository(Role).findOne({
        where: { id: roleId },
        select: { id: true, roleName: true },
        loadEagerRelations: false,
      });
      const removesSuperAdmin = role?.roleName === ROLES.SUPER_ADMIN;

      const superAdminHolders = removesSuperAdmin ? await this.lockRoleHolders(repo, roleId) : [];
      const held = await this.lockRowsOfUser(repo, userId);

      if (!held.some((row) => row.roleId === roleId)) return false;

      if (actorId === userId) {
        throw new ForbiddenException('You cannot change your own roles.');
      }
      if (held.length <= 1) {
        throw new ForbiddenException('A user must hold at least one role.');
      }
      if (removesSuperAdmin && !superAdminHolders.some((row) => row.userId !== userId)) {
        throw new ForbiddenException('Cannot remove the last SUPER_ADMIN — at least one user must hold this role.');
      }

      await repo.delete({ userId, roleId });
      await this.audit.record(
        {
          moduleName: 'user_roles',
          entityId: userId,
          action: 'REVOKE_ROLE',
          oldValue: { roleIds: held.map((row) => row.roleId) },
          newValue: { roleIds: held.filter((row) => row.roleId !== roleId).map((row) => row.roleId) },
          performedBy: actorId,
        },
        tx,
      );
      return true;
    });
  }

  /** A `manager` passed in is the caller's already-open transaction and is used as-is (this codebase's
   *  convention for every manager-threaded write — see AuditService.record, CustomerService.
   *  createWithManager); without one, this call is its own unit of work. */
  private inTransaction<T>(manager: EntityManager | undefined, work: (tx: EntityManager) => Promise<T>): Promise<T> {
    return manager ? work(manager) : this.userRoles.manager.transaction(work);
  }

  private lockRowsOfUser(repo: Repository<UserRole>, userId: number): Promise<UserRole[]> {
    return repo
      .createQueryBuilder('ur')
      .setLock('pessimistic_write')
      .where('ur.userId = :userId', { userId })
      .orderBy('ur.id', 'ASC')
      .getMany();
  }

  private lockRoleHolders(repo: Repository<UserRole>, roleId: number): Promise<UserRole[]> {
    return repo.createQueryBuilder('ur').setLock('pessimistic_write').where('ur.roleId = :roleId', { roleId }).getMany();
  }
}
