import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { ROLES } from '@app/common/constants/global';
import { Actor, actorUserId, initialSuperAdminProtectedMessage, SUPER_ADMIN_ASSIGN_MESSAGE, SUPER_ADMIN_MODIFY_MESSAGE, isSuperAdminActor } from '../../common/security/actor';
import { ADMINISTRATOR_ROLES, isAdministratorRoleName } from '../../common/security/administrator-roles';
import { AssignmentBoundaryService } from '../iam/assignment-boundary.service';
import { UserRole } from './entities/user-role.entity';
import { Role } from '../role/entities/role.entity';
import { AuditService } from '../../audit/audit.service';
import { MYSQL_ERROR_CODE, LOCK_MODE } from '../../common/constants/database.constants';
import { SORT_ORDER } from '../../common/constants/sort.constants';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { AUDIT_MODULE } from '../../audit/audit.constants';
import { ACTOR_KIND } from '../../common/constants/auth.constants';

// Same MySQL duplicate-key idiom MeterService/IngestionService use for their own unique-index races.
const isDuplicateKeyError = (err: unknown): boolean =>
  /duplicate entry/i.test(err instanceof Error ? err.message : '') || (err as { code?: string })?.code === MYSQL_ERROR_CODE.DUP_ENTRY;

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
 *
 * Both writes take the `Actor` performing them and enforce the PRIVILEGE rules here, in the one place
 * every role change goes through: only a super administrator (a SUPER_ADMIN, see
 * common/security/administrator-roles.ts — or the system) may grant the SUPER_ADMIN
 * role, and only one may change the roles of a user who holds it. The CREATE_USER / EDIT_USER
 * permissions (adding or removing roles is gated by EDIT_USER; "ASSIGN_ROLE" is only the name of the audit
 * row) deliberately carry no such authority: a delegated administrator ("ADMIN") can assign every
 * ordinary role it is allowed to, but can never mint, demote or take over a super administrator. The last
 * active holder of an administrator role can never be removed, deactivated or deleted, so the installation
 * always keeps someone who can administer it — and neither can the INITIAL administrator (the oldest active
 * holder), however many others there are. Every grant is also held to the ASSIGNMENT BOUNDARY: an actor may
 * hand out only roles whose permissions it holds itself (iam/assignment-boundary.service.ts) — and so is
 * taking over an account by resetting its password (assertActorMayTakeOverAccount).
 */
@Injectable()
export class UserRoleService {
  constructor(
    @InjectRepository(UserRole)
    private readonly userRoles: Repository<UserRole>,

    private readonly audit: AuditService,

    private readonly boundary: AssignmentBoundaryService,
  ) {}

  async getPrimaryRoleId(userId: number): Promise<number | null> {
    const row = await this.userRoles.findOne({ where: { userId }, order: { id: SORT_ORDER.ASC } });
    return row?.roleId ?? null;
  }

  /** Resolves BOTH `roleId` and `roleName` of the PRIMARY role in one query (joins Role) — this is
   *  what AuthService's JWT-issuing login()/refresh() call, since the signed payload needs both (and
   *  carries the primary role only). Returns null if the user has no role row at all (should not
   *  happen for any active staff account, but handled explicitly rather than assumed — see the call
   *  sites' own null-check). */
  async getPrimaryRole(userId: number): Promise<{ roleId: number; roleName: string } | null> {
    const row = await this.userRoles.findOne({ where: { userId }, order: { id: SORT_ORDER.ASC }, relations: { role: true } });
    if (!row) return null;
    return { roleId: row.roleId, roleName: row.role.roleName };
  }

  /** Every role id this user holds, in assignment order — the set authorization decisions use. */
  async getRoleIds(userId: number): Promise<number[]> {
    const rows = await this.userRoles.find({ where: { userId }, order: { id: SORT_ORDER.ASC } });
    return rows.map((r) => r.roleId);
  }

  /** Full Role entities for a user, ordered the same deterministic way as getPrimaryRole/getRoleIds
   *  (so the first is the primary). Replaces the old `user.role` eager relation for call sites that
   *  need the whole Role object (e.g. a detail-screen response), not just the id/name pair
   *  getPrimaryRole returns. */
  async getRolesForUser(userId: number): Promise<Role[]> {
    const rows = await this.userRoles.find({ where: { userId }, order: { id: SORT_ORDER.ASC }, relations: { role: true } });
    // A role soft-deleted after it was assigned joins to null. It grants nothing, and this feeds the
    // principal JwtStrategy builds on every request — skipping it keeps one stale row from turning
    // every request by that user into a TypeError.
    return rows.map((r) => r.role).filter((role): role is Role => !!role);
  }

  /** The id and name of every live role this user holds, in assignment order, as ONE lean query (no
   *  eager relations) — what JwtStrategy resolves on every authenticated request. Same semantics as
   *  getRolesForUser, minus the Role columns and joins a per-request permission check never reads. */
  async getRoleRefsForUser(userId: number): Promise<Array<{ id: number; roleName: string }>> {
    const rows = await this.userRoles
      .createQueryBuilder('ur')
      .innerJoin(Role, 'role', 'role.id = ur.roleId AND role.deletedAt IS NULL')
      .where('ur.userId = :userId', { userId })
      .select('role.id', 'id')
      .addSelect('role.roleName', 'roleName')
      .orderBy('ur.id', SORT_ORDER.ASC)
      .getRawMany<{ id: number | string; roleName: string }>();
    return rows.map((row) => ({ id: Number(row.id), roleName: row.roleName }));
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
      .orderBy('ur.id', SORT_ORDER.ASC)
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
      .orderBy('ur.id', SORT_ORDER.ASC)
      .getRawMany();
    return rows.map((r) => ({ userId: Number(r.userId), roleId: Number(r.roleId), roleName: r.roleName }));
  }

  /** Every user that still exists (not soft-deleted) and currently holds a specific roleId — the reverse
   *  of getRoleIds (which resolves a user's roles; this resolves a role's users). A soft-deleted user's
   *  leftover assignment row is not an assigned user, so it neither inflates counts nor blocks deleting
   *  the role. `activeOnly` additionally drops deactivated accounts — what
   *  WorkflowSlaSchedulerService needs to find who to notify when a workflow level's approver role
   *  breaches its SLA; role counts and the role-delete guard keep deactivated users, since reactivating
   *  one must not leave them holding a deleted role. */
  async getUsersByRoleId(roleId: number, activeOnly = false): Promise<Array<{ userId: number }>> {
    const qb = this.userRoles
      .createQueryBuilder('ur')
      .innerJoin('ur.user', 'user', 'user.deletedAt IS NULL')
      .where('ur.roleId = :roleId', { roleId })
      .select('ur.userId', 'userId');
    if (activeOnly) qb.andWhere('user.active = :active', { active: true });
    const rows = await qb.getRawMany<{ userId: number | string }>();
    return rows.map((r) => ({ userId: Number(r.userId) }));
  }

  /** The batched equivalent of `getUsersByRoleId().length` — for the Roles list screen, which needs
   *  an "assigned users" count per role across a whole page of roles in one query, not one count
   *  query per row (N+1). A role with zero assigned users is simply absent from the result map —
   *  callers default to 0 via `?? 0`, never treat a missing entry as an error. Counts only users who
   *  still exist (a soft-deleted user's leftover assignment row is not an assigned user). */
  async getUserCountsByRoleIds(roleIds: number[]): Promise<Map<number, number>> {
    if (roleIds.length === 0) return new Map();
    const rows = await this.userRoles
      .createQueryBuilder('ur')
      .innerJoin('ur.user', 'user', 'user.deletedAt IS NULL')
      .where('ur.roleId IN (:...roleIds)', { roleIds })
      .select('ur.roleId', 'roleId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ur.roleId')
      .getRawMany();
    return new Map(rows.map((r) => [Number(r.roleId), Number(r.count)]));
  }

  /** The names of the live roles this user currently holds (inside `manager`'s transaction when given). */
  async getRoleNamesForUser(userId: number, manager?: EntityManager): Promise<string[]> {
    const repo = (manager ?? this.userRoles.manager).getRepository(UserRole);
    const rows = await repo.find({ where: { userId }, relations: { role: true } });
    return rows.map((row) => row.role?.roleName).filter((name): name is string => !!name);
  }

  /** True when the user holds the administrator role (SUPER_ADMIN). What the workflow engine asks: an
   *  administrator role administers the system and never acts at an approval level. */
  async holdsAdministratorRole(userId: number, manager?: EntityManager): Promise<boolean> {
    return (await this.getRoleNamesForUser(userId, manager)).some(isAdministratorRoleName);
  }

  /** A SUPER_ADMIN account may only be modified (profile, deactivation, deletion, role change,
   *  credentials, sessions) by a super administrator — EDIT_USER, DELETE_USER and RESET_USER_PASSWORD are
   *  delegable permissions and must never be a path to taking over, locking out or removing the
   *  accounts that sit above them. Throws 403 otherwise. */
  async assertActorMayModifyUser(actor: Actor, targetUserId: number, manager?: EntityManager): Promise<void> {
    if (isSuperAdminActor(actor)) return;
    const heldRoleNames = await this.getRoleNamesForUser(targetUserId, manager);
    if (heldRoleNames.some(isAdministratorRoleName)) {
      throw new ForbiddenException(SUPER_ADMIN_MODIFY_MESSAGE);
    }
  }

  /**
   * Resetting someone's credentials hands the actor a working login for that account, which is a grant of everything the account can do —
   * so it is held to the same ASSIGNMENT BOUNDARY as handing out a role: a delegated administrator may take over an account only if every
   * permission the account holds is one the administrator holds itself. Without this, RESET_USER_PASSWORD (a delegable permission) would be
   * a way around the boundary on addRolesToUser: reset a more privileged user's password, then sign in as them. A super administrator and
   * the system are unbounded, and nobody is "beyond" their own account. `action` completes "Cannot …" ("reset the password of"). 403 otherwise.
   * Only taking over is bounded: ordinary edits, deactivation, deletion and ending sessions stay governed by their own permissions.
   */
  async assertActorMayTakeOverAccount(actor: Actor, targetUserId: number, action: string, manager?: EntityManager): Promise<void> {
    await this.boundary.assertAccountWithinBoundary(actor, targetUserId, action, manager);
  }

  /** The ids of every ACTIVE, non-deleted holder of the administrator role `roleName`, read with a pessimistic write
   *  lock inside `tx`. A deactivated or soft-deleted holder is not a usable administrator, so it must
   *  not count toward "someone can still grant this back". Held to commit: two admins removing each
   *  other at the same moment queue on this lock, so the second reads the first's result (and is
   *  refused) instead of both passing the check. */
  async lockActiveHolders(tx: EntityManager, roleName: string): Promise<number[]> {
    const role = await tx.getRepository(Role).findOne({
      where: { roleName },
      select: { id: true },
      loadEagerRelations: false,
    });
    if (!role) return [];
    const rows = await tx
      .getRepository(UserRole)
      .createQueryBuilder('ur')
      .innerJoin('ur.user', 'user', 'user.active = :active AND user.deletedAt IS NULL', { active: true })
      .where('ur.roleId = :roleId', { roleId: role.id })
      .setLock(LOCK_MODE.PESSIMISTIC_WRITE)
      .getMany();
    return rows.map((row) => row.userId);
  }

  /** Refuses (403) an operation that would leave the installation with no active administrator: if `userId` is the last ACTIVE holder of SUPER_ADMIN,
   *  they cannot be deleted, deactivated, demoted or have their sign-in disabled — an installation must always keep someone who can
   *  administer it. This is also what keeps the initial SUPER_ADMIN from being removed by accident: while it is the only one, nothing in
   *  the application can take the role away. Only the administrator roles the user actually holds are locked (a user who holds none cannot
   *  be the last administrator), in ADMINISTRATOR_ROLES order so two concurrent checks never take the locks in opposite orders. The
   *  message names the stored role. Must run inside the same transaction as the change it guards. */
  async assertNotLastActiveAdministrator(userId: number, tx: EntityManager, action: string): Promise<void> {
    const heldRoleNames = await this.getRoleNamesForUser(userId, tx);
    for (const roleName of ADMINISTRATOR_ROLES) {
      if (!heldRoleNames.includes(roleName)) continue;
      const holders = await this.lockActiveHolders(tx, roleName);
      if (holders.includes(userId) && !holders.some((holder) => holder !== userId)) {
        throw new ForbiddenException(`Cannot ${action} the last active ${roleName} — at least one active user must hold this role.`);
      }
      // The INITIAL administrator is protected even while others exist (see initialAdministratorId).
      if (userId === this.initialAdministratorId(holders)) {
        throw new ForbiddenException(initialSuperAdminProtectedMessage(action));
      }
    }
  }

  /**
   * The installation's INITIAL administrator: the lowest-id ACTIVE, non-deleted holder of SUPER_ADMIN — the account the first-start seed
   * (or the maintenance tool) created first, because user ids only ever grow. It is derived from the data, so it needs no marker column
   * and moves on by itself if that account is ever retired through the server maintenance tool (the next-oldest active administrator
   * becomes the initial one). `null` when nobody holds the role.
   */
  initialAdministratorId(activeHolderIds: readonly number[]): number | null {
    return activeHolderIds.length === 0 ? null : Math.min(...activeHolderIds);
  }

  /**
   * Refuses (403) an action that would delete, deactivate, demote or lock out the INITIAL administrator (see initialAdministratorId) — for
   * the paths that are not already guarded inside a locking transaction (disabling someone's sign-in is one). Read-only, no lock. The
   * transactional paths get the same rule from assertNotLastActiveAdministrator / removeRoleFromUser. It is deliberately NOT a rule
   * against changing the account's other details or resetting its password: only losing the owner is guarded, not looking after them.
   */
  async assertNotInitialAdministrator(userId: number, action: string, manager?: EntityManager): Promise<void> {
    const holders = await this.activeAdministratorIds(manager);
    if (userId === this.initialAdministratorId(holders)) throw new ForbiddenException(initialSuperAdminProtectedMessage(action));
  }

  /** The ids of every ACTIVE, non-deleted SUPER_ADMIN holder, read WITHOUT a lock (callers that need the lock use lockActiveHolders). */
  private async activeAdministratorIds(manager?: EntityManager): Promise<number[]> {
    const db = manager ?? this.userRoles.manager;
    const role = await db.getRepository(Role).findOne({ where: { roleName: ROLES.SUPER_ADMIN }, select: { id: true }, loadEagerRelations: false });
    if (!role) return [];
    const rows = await db
      .getRepository(UserRole)
      .createQueryBuilder('ur')
      .innerJoin('ur.user', 'user', 'user.active = :active AND user.deletedAt IS NULL', { active: true })
      .where('ur.roleId = :roleId', { roleId: role.id })
      .getMany();
    return rows.map((row) => row.userId);
  }

  /** Grants `roleIds` to `userId` — ADDITIVE and idempotent: ids the user already holds are skipped
   *  (never an error, never an update), nothing is ever removed, and the ids actually granted are
   *  returned in grant order. A request that changes nothing writes nothing — no insert, no audit row.
   *  Callers validate that every role exists (a 404) beforehand; the FK is only the backstop.
   *
   *  `manager` is the caller's own open transaction (UserService.create, BootstrapService's seed), so
   *  the grant and its audit row commit or roll back together with the caller's User row. Without one,
   *  this opens its own, so a multi-role grant and its single ASSIGN_ROLE audit row are atomic either
   *  way. The boot-time seed passes SYSTEM_ACTOR; every request-driven call passes the signed-in user.
   *
   *  Privilege rules, enforced HERE (not by the callers) against the rows read inside this transaction:
   *   - only a super administrator actor (SUPER_ADMIN, or the system) may grant an administrator role —
   *     a 403 with SUPER_ADMIN_ASSIGN_MESSAGE for anyone else (a delegated "ADMIN" included), whatever else is in the request, so a
   *     manipulated payload cannot smuggle it in;
   *   - only a super administrator actor may change the roles of a user who already holds an administrator role;
   *   - an actor may not grant roles to their OWN user (self-escalation with no second party
   *     accountable for it), yet a request that adds nothing is a no-op and stays allowed;
   *   - the ASSIGNMENT BOUNDARY: a delegated administrator may hand out only roles whose permissions it holds ITSELF — a role that grants
   *     anything the actor lacks refuses the whole request (AssignmentBoundaryService). A super administrator and the system are unbounded.
   *  Granting can only grow the set, so unlike removal it needs no row locks: the unique (user_id,
   *  role_id) key already makes a duplicate grant impossible. A locking read here would also be harmful —
   *  over a brand-new user's still-empty range (UserService.create) it only takes a gap lock, and two
   *  concurrent creations would then deadlock on each other's gap lock when both insert. */
  async addRolesToUser(userId: number, roleIds: number[], manager: EntityManager | undefined, actor: Actor): Promise<number[]> {
    const requested = [...new Set(roleIds)];
    if (requested.length === 0) return [];

    return this.inTransaction(manager, async (tx) => {
      const repo = tx.getRepository(UserRole);
      const heldRoleIds = (await repo.find({ where: { userId }, order: { id: SORT_ORDER.ASC } })).map((row) => row.roleId);
      const missing = requested.filter((roleId) => !heldRoleIds.includes(roleId));
      if (missing.length === 0) return [];

      let involved: Role[] = [];
      if (!isSuperAdminActor(actor)) {
        involved = await tx.getRepository(Role).find({
          where: { id: In([...heldRoleIds, ...missing]) },
          select: { id: true, roleName: true },
          loadEagerRelations: false,
        });
        // Matched on the EXACT stored name (isAdministratorRoleName), never on what the database would also match. Handing an
        // administrator role out is refused first; merely touching the roles of someone who already holds one is refused second.
        // (A super administrator actor and the system skip this whole block.)
        const administrators = involved.filter((role) => isAdministratorRoleName(role.roleName));
        if (administrators.some((role) => missing.includes(role.id))) throw new ForbiddenException(SUPER_ADMIN_ASSIGN_MESSAGE);
        if (administrators.length > 0) throw new ForbiddenException(SUPER_ADMIN_MODIFY_MESSAGE);
      }

      if (actor.kind === ACTOR_KIND.USER && actor.id === userId) {
        throw new ForbiddenException(ERROR_MESSAGES.CANNOT_CHANGE_OWN_ROLES);
      }

      // The assignment boundary: only what the actor holds itself may be handed on. Checked before anything is written, so a refused
      // request changes nothing; a super administrator (and the system) is unbounded and skips the lookup.
      if (!isSuperAdminActor(actor)) {
        await this.boundary.assertWithinBoundary(
          actor,
          involved.filter((role) => missing.includes(role.id)),
          tx,
        );
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
          moduleName: AUDIT_MODULE.USER_ROLES,
          entityId: userId,
          action: 'ASSIGN_ROLE',
          oldValue: { roleIds: heldRoleIds },
          newValue: { roleIds: [...heldRoleIds, ...added] },
          performedBy: actorUserId(actor),
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
   *  Rules, all ForbiddenException, all evaluated inside THIS transaction against rows locked
   *  with pessimistic_write (a check made before the transaction could be invalidated by a concurrent
   *  change before the delete lands), in this order:
   *    1. Privilege — only a super administrator actor may change the roles of a user who holds an administrator
   *       role (which includes removing that role itself).
   *    2. No self-change — an actor cannot revoke roles from their own user; role changes must be
   *       made by someone else so a second party is always accountable. A no-op is still allowed.
   *    3. Last role — a user must keep at least one. Login and JwtStrategy both reject a role-less
   *       user, so removing the last role is an instant lock-out of that account.
   *    4. Last active SUPER_ADMIN — the role RolesGuard bypasses on and the bootstrap grant reconciliation
   *       keys on must always keep at least one ACTIVE, non-deleted holder, or every admin-only surface
   *       (including user/role management itself) is left with no one able to grant it back.
   *    5. The INITIAL administrator (the oldest active holder) can never be demoted, even while others exist.
   *
   *  Lock order: the SUPER_ADMIN holders' rows (only when revoking SUPER_ADMIN) are locked BEFORE the
   *  user's own rows. Two admins demoting each other's SUPER_ADMIN at the same moment then queue up on
   *  that shared lock and the second one reads the first one's committed result — and is refused —
   *  instead of each holding the other's row and deadlocking. The locks are held to commit, so two
   *  concurrent removals can never both pass the last-SUPER_ADMIN check. */
  async removeRoleFromUser(userId: number, roleId: number, manager: EntityManager | undefined, actor: Actor): Promise<boolean> {
    return this.inTransaction(manager, async (tx) => {
      const repo = tx.getRepository(UserRole);

      const role = await tx.getRepository(Role).findOne({
        where: { id: roleId },
        select: { id: true, roleName: true },
        loadEagerRelations: false,
      });
      const removedRoleName = role?.roleName;
      // Only an administrator role carries the last-holder protection (exact stored name).
      const removedAdministratorRole = isAdministratorRoleName(removedRoleName) ? removedRoleName : null;

      const activeAdministratorHolders = removedAdministratorRole ? await this.lockActiveHolders(tx, removedAdministratorRole) : [];
      const held = await this.lockRowsOfUser(repo, userId);

      if (!held.some((row) => row.roleId === roleId)) return false;

      await this.assertActorMayModifyUser(actor, userId, tx);

      if (actor.kind === ACTOR_KIND.USER && actor.id === userId) {
        throw new ForbiddenException(ERROR_MESSAGES.CANNOT_CHANGE_OWN_ROLES);
      }
      if (held.length <= 1) {
        throw new ForbiddenException('A user must hold at least one role.');
      }
      if (
        removedAdministratorRole &&
        activeAdministratorHolders.includes(userId) &&
        !activeAdministratorHolders.some((holder) => holder !== userId)
      ) {
        throw new ForbiddenException(`Cannot remove the last active ${removedAdministratorRole} — at least one active user must hold this role.`);
      }
      if (removedAdministratorRole && userId === this.initialAdministratorId(activeAdministratorHolders)) {
        throw new ForbiddenException(initialSuperAdminProtectedMessage('demote'));
      }

      await repo.delete({ userId, roleId });
      await this.audit.record(
        {
          moduleName: AUDIT_MODULE.USER_ROLES,
          entityId: userId,
          action: 'REVOKE_ROLE',
          oldValue: { roleIds: held.map((row) => row.roleId) },
          newValue: { roleIds: held.filter((row) => row.roleId !== roleId).map((row) => row.roleId) },
          performedBy: actorUserId(actor),
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
      .setLock(LOCK_MODE.PESSIMISTIC_WRITE)
      .where('ur.userId = :userId', { userId })
      .orderBy('ur.id', SORT_ORDER.ASC)
      .getMany();
  }
}
