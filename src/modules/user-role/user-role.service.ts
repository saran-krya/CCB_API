import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserRole } from './entities/user-role.entity';
import { Role } from '../role/entities/role.entity';

/**
 * The SINGLE source of truth for "what role does this user have" — `users.role_id` no longer
 * exists (removed per the user_roles migration; see UserRole entity's own doc comment). Every
 * consumer that used to read `user.role`/`user.roleId` directly now goes through this service
 * instead, including the non-RBAC business lookups (Field Inspection eligibility, Reporting
 * Manager/Field Inspector pickers, the Users dashboard) that were migrated alongside the RBAC path.
 *
 * `getPrimaryRoleId`/`getPrimaryRole` return exactly one role today — the single row every user
 * currently has — ordered by `id ASC` so a user's original/first-granted role wins deterministically
 * if more than one row ever exists in the future. This is the ONE seam a future "true multi-role"
 * change would widen (e.g. have callers merge permissions across all of `getRoleIds`'s results) — no
 * other RBAC code needs to change for that, since `roleHasAction`/`getUserPermissions` are already
 * role-keyed, not user-keyed, and can be called once per role and OR'd together.
 */
@Injectable()
export class UserRoleService {
  constructor(
    @InjectRepository(UserRole)
    private readonly userRoles: Repository<UserRole>,
  ) {}

  async getPrimaryRoleId(userId: number): Promise<number | null> {
    const row = await this.userRoles.findOne({ where: { userId }, order: { id: 'ASC' } });
    return row?.roleId ?? null;
  }

  /** Resolves BOTH `roleId` and `roleName` in one query (joins Role) — this is what AuthService's
   *  JWT-issuing login()/refresh() call, since the signed payload needs both. Returns null if the
   *  user has no role row at all (should not happen for any active staff account, but handled
   *  explicitly rather than assumed — see the call sites' own null-check). */
  async getPrimaryRole(userId: number): Promise<{ roleId: number; roleName: string } | null> {
    const row = await this.userRoles.findOne({ where: { userId }, order: { id: 'ASC' }, relations: { role: true } });
    if (!row) return null;
    return { roleId: row.roleId, roleName: row.role.roleName };
  }

  async getRoleIds(userId: number): Promise<number[]> {
    const rows = await this.userRoles.find({ where: { userId }, order: { id: 'ASC' } });
    return rows.map((r) => r.roleId);
  }

  /** Full Role entities for a user, ordered the same deterministic way as getPrimaryRole/getRoleIds.
   *  Replaces the old `user.role` eager relation for call sites that need the whole Role object
   *  (e.g. a detail-screen response), not just the id/name pair getPrimaryRole returns. */
  async getRolesForUser(userId: number): Promise<Role[]> {
    const rows = await this.userRoles.find({ where: { userId }, order: { id: 'ASC' }, relations: { role: true } });
    return rows.map((r) => r.role);
  }

  /** Single-user capability check — does ANY role this user holds have `capability` set? Today a
   *  user has exactly one role, so this is equivalent to checking that one role, but written against
   *  `getRoleIds` so it keeps working unchanged if a user is ever granted more than one role. */
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
   *  one row per (user, role) pair — today that's one row per user, since a user has exactly one
   *  role, but this shape stays correct if a user is ever granted more than one qualifying role. */
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
      .getRawMany();
    return rows.map((r) => ({ userId: Number(r.userId), roleId: Number(r.roleId), roleName: r.roleName }));
  }

  /** Sets this user's one role, replacing any existing row(s) — matches today's actual UI/DTO
   *  shape (`CreateUserDto.roleId: number`, a single-select dropdown), not a multi-role grant API.
   *  Accepts an optional transaction manager so UserService.create/update can keep this write in
   *  the same atomic unit of work as the Customer row (same convention as this codebase's other
   *  manager-threaded writes — see CustomerService.createWithManager). */
  async setPrimaryRole(userId: number, roleId: number, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserRole) : this.userRoles;
    await repo.delete({ userId });
    await repo.save(repo.create({ userId, roleId }));
  }
}
