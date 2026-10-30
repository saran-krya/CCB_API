import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/utils/pagination.util';
import { ROLES } from '@app/common/constants/global';

import {
  CreateRoleDto,
  UpdateRoleDto,
} from './dto/create-role.dto';

import { RolePickerQueryDto } from './dto/role-picker-query.dto';
import { Role } from './entities/role.entity';
import { RoleQueryDto } from '@app/common/dto/role-paginatoin.dto';
import { LovService } from '../lov/lov.service';
import { UserRoleService } from '../user-role/user-role.service';

// Correlated subqueries behind the sortable count columns — selected as aliases (never joined) so a page
// still holds one row per role.
const ASSIGNED_USER_COUNT_SQL = `(
  SELECT COUNT(*)
  FROM user_roles ur_count
  WHERE ur_count.role_id = role.id AND ur_count.deleted_at IS NULL
)`;
const POLICY_COUNT_SQL = `(
  SELECT COUNT(*)
  FROM role_policies rp_count
  WHERE rp_count.roleId = role.id AND rp_count.deleted_at IS NULL
)`;

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roles: Repository<Role>,

    private readonly lovService: LovService,

    private readonly audit: AuditService,

    private readonly userRoleService: UserRoleService,

    // Raw COUNT checks only (workflow_approval_levels / workflow_definition_levels /
    // workflow_instance_steps), in remove() below — avoids importing Workflow's entities into this
    // module just for an existence check, and the risk of a circular module dependency that would
    // bring (Role -> Workflow -> ... -> Role already depends on Role the other way).
    private readonly dataSource: DataSource,
  ) { }

  async create(
    dto: CreateRoleDto,
    actorId?: number,
  ) {
    const existingRole =
      await this.roles.findOne({
        where: {
          roleName: dto.roleName,
        },
      });

    if (existingRole) {
      throw new ConflictException(
        'Role already exists',
      );
    }

    const role = this.roles.create({
      roleName: dto.roleName,
      roleDescription:
        dto.roleDescription,
      userCategoryId:
        dto.userCategoryId,
      canBeReportingManager:
        dto.canBeReportingManager ??
        false,
    });

    const saved =
      await this.roles.save(role);

    await this.audit.record({
      moduleName: 'roles',
      entityId: saved.id,
      action: 'CREATE',
      newValue: saved,
      performedBy: actorId,
    });

    return saved;
  }

  /** Roles list: searched, filtered by User Category / created date, sorted and paged here. The counts are
   *  correlated subqueries exposed as selected aliases (one row per role, and an alias is what TypeORM can
   *  order a skip/take page by). `isSystem` / `deleteBlockedReason` are the server's own rules, so the client
   *  never decides from a role's name whether it may be deleted. The User Category filter's options ride along
   *  in `meta` so the client never hardcodes which categories exist. */
  async RoleLists(
    query: RoleQueryDto,
  ) {
    const qb = this.roles
      .createQueryBuilder("role")
      .leftJoinAndSelect("role.userCategory", "userCategory")
      .addSelect(ASSIGNED_USER_COUNT_SQL, "assigned_user_count")
      .addSelect(POLICY_COUNT_SQL, "policy_count");

    const term = query["search.query"]?.trim();
    if (term) {
      qb.andWhere(
        `(role.roleName LIKE :term OR role.roleDescription LIKE :term OR userCategory.label LIKE :term)`,
        { term: `%${term}%` },
      );
    }

    if (query.userCategoryId) {
      qb.andWhere(
        "role.userCategoryId = :userCategoryId",
        { userCategoryId: query.userCategoryId },
      );
    }

    if (query["search.createdAt"]) {
      qb.andWhere(
        "DATE(role.createdAt) = :createdAt",
        { createdAt: query["search.createdAt"] },
      );
    }

    const direction = query.sortOrder === "ASC" ? "ASC" : "DESC";
    const sortColumns = {
      roleName: "role.roleName",
      userCategory: "userCategory.label",
      assignedUserCount: "assigned_user_count",
      policyCount: "policy_count",
      createdAt: "role.createdAt",
    } as const;
    const sortColumn = sortColumns[query.sortBy ?? "createdAt"] ?? sortColumns.createdAt;
    qb.orderBy(sortColumn, direction);
    // Ties fall back to the name so the order never jumps between requests.
    if (sortColumn !== sortColumns.roleName) qb.addOrderBy("role.roleName", "ASC");

    const [result, userCategories] = await Promise.all([
      paginate(qb, query),
      this.lovService.findByCategory("USER_CATEGORY"),
    ]);

    // One grouped query per count for the whole page, not one per row — see
    // UserRoleService.getUserCountsByRoleIds's own doc comment on why this avoids N+1.
    const roleIds = result.items.map((role) => role.id);
    const [userCounts, policyCounts] = await Promise.all([
      this.userRoleService.getUserCountsByRoleIds(roleIds),
      this.getPolicyCountsByRoleIds(roleIds),
    ]);

    return {
      items: result.items.map((role) => {
        const assignedUserCount = userCounts.get(role.id) ?? 0;
        return {
          roleId: role.id,
          roleName: role.roleName,
          roleDescription: role.roleDescription,
          userCategoryType: role.userCategory?.label ?? null,
          created: role.createdAt,
          assignedUserCount,
          policyCount: policyCounts.get(role.id) ?? 0,
          isSystem: this.isSystemRole(role),
          deleteBlockedReason: this.deleteBlockedReason(role, assignedUserCount),
        };
      }),
      pagination: result.pagination,
      meta: { userCategoryOptions: this.toCategoryOptions(userCategories) },
    };
  }

  /** The system-managed role (SUPER_ADMIN): RolesGuard's bypass and every boot-time grant reconciliation
   *  match it by this exact name, so it can be neither renamed nor deleted. */
  private isSystemRole(role: Pick<Role, "roleName">): boolean {
    return role.roleName === ROLES.SUPER_ADMIN;
  }

  /** Why this role can't be deleted from the list, or null when it can be tried. The delete itself still
   *  enforces every rule (see remove) — this only lets the list say so up front. */
  private deleteBlockedReason(role: Pick<Role, "roleName">, assignedUserCount: number): string | null {
    if (this.isSystemRole(role)) return `${role.roleName} is a system role and can't be deleted.`;
    if (assignedUserCount > 0) {
      return `Assigned to ${assignedUserCount} user${assignedUserCount === 1 ? "" : "s"} — reassign them to a different role first.`;
    }
    return null;
  }

  private toCategoryOptions(categories: { id: number; label: string }[]) {
    return categories
      .map((category) => ({ value: category.id, label: category.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Policies attached per role, for a page of roles — one grouped query. Roles with none are absent. */
  private async getPolicyCountsByRoleIds(roleIds: number[]): Promise<Map<number, number>> {
    if (roleIds.length === 0) return new Map();
    const rows: { roleId: number; count: string }[] = await this.dataSource.query(
      `SELECT roleId AS roleId, COUNT(*) AS count FROM role_policies WHERE deleted_at IS NULL AND roleId IN (${roleIds.map(() => "?").join(",")}) GROUP BY roleId`,
      roleIds,
    );
    return new Map(rows.map((row) => [Number(row.roleId), Number(row.count)]));
  }


  async getRoleDropdown(
    userCategoryId?: number,
  ) {
    const qb = this.roles
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.userCategory', 'userCategory');

    if (userCategoryId) {
      qb.andWhere('role.userCategoryId = :userCategoryId', { userCategoryId });
    }

    const roles = await qb.orderBy('role.roleName', 'ASC').getMany();

    // The Roles picker on Create / Edit User shows how many users hold each role. Same batched count the Roles
    // list uses for "Assigned Users" — one grouped query for the whole list, never one per role.
    const userCounts = await this.userRoleService.getUserCountsByRoleIds(roles.map((role) => role.id));

    return roles.map((role) => ({
      id: role.id,
      name: role.roleName,
      // Additive field — Create User's "Set permissions" step shows this short description when
      // picking a role (AWS IAM-inspired redesign). Deliberately extending this already-reachable-
      // by-this-page dropdown endpoint rather than adding a call to a more restrictively-guarded
      // one (GET /roles/:id and the role-policies endpoints are effectively SUPER_ADMIN-only today —
      // see role.controller.ts's own class-level @Roles(ADMIN) comment), so this keeps working for
      // whichever role the page's own CREATE_USER/EDIT_USER permission is actually granted to.
      description: role.roleDescription ?? null,
      userCategoryId: role.userCategoryId,
      userCategoryLabel: role.userCategory?.label ?? null,
      canBeReportingManager: role.canBeReportingManager,
      assignedUserCount: userCounts.get(role.id) ?? 0,
    }));
  }

  /** The Roles picker on Create / Edit User: the same rows as getRoleDropdown, but searched, filtered by
   *  User Category, sorted and paged here — the web client sends only the query and renders the page. The
   *  "Filter by Type" options ride along in `meta` so the client never hardcodes which categories exist.
   *  The user count is a correlated subquery exposed as a selected alias (one row per role, and an alias
   *  is what TypeORM can order a skip/take page by). */
  async getRolePicker(query: RolePickerQueryDto) {
    const qb = this.roles
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.userCategory', 'userCategory')
      .addSelect(ASSIGNED_USER_COUNT_SQL, 'assigned_user_count');

    const term = query['search.query']?.trim();
    if (term) {
      qb.andWhere(
        `(role.roleName LIKE :term OR role.roleDescription LIKE :term OR userCategory.label LIKE :term)`,
        { term: `%${term}%` },
      );
    }
    if (query.userCategoryId) {
      qb.andWhere('role.userCategoryId = :userCategoryId', { userCategoryId: query.userCategoryId });
    }

    const direction = query.sortOrder === 'DESC' ? 'DESC' : 'ASC';
    const sortColumn =
      query.sortBy === 'users' ? 'assigned_user_count' : query.sortBy === 'type' ? 'userCategory.label' : 'role.roleName';
    qb.orderBy(sortColumn, direction);
    // Ties fall back to the name so the order never jumps between requests.
    if (sortColumn !== 'role.roleName') qb.addOrderBy('role.roleName', 'ASC');

    const [page, userCategories] = await Promise.all([
      paginate(qb, query),
      this.lovService.findByCategory('USER_CATEGORY'),
    ]);

    const userCounts = await this.userRoleService.getUserCountsByRoleIds(page.items.map((role) => role.id));

    return {
      items: page.items.map((role) => ({
        id: role.id,
        name: role.roleName,
        description: role.roleDescription ?? null,
        userCategoryId: role.userCategoryId,
        userCategoryLabel: role.userCategory?.label ?? null,
        canBeReportingManager: role.canBeReportingManager,
        assignedUserCount: userCounts.get(role.id) ?? 0,
      })),
      pagination: page.pagination,
      meta: { typeOptions: this.toCategoryOptions(userCategories) },
    };
  }

  async getRoleFilter() {
    const roles = await this.roles
      .createQueryBuilder("role")
      .select([
        "role.id",
        "role.roleName",
      ])
      .orderBy(
        "role.roleName",
        "ASC",
      )
      .getMany();

    return roles.map((role) => ({
      id: role.id,
      name: role.roleName,
    }));
  }

  async getFilterMetadata() {
    const userCategories = await this.lovService.findByCategory('USER_CATEGORY');

    return {
      userCategories: userCategories.map((lv) => ({ id: lv.id, name: lv.label })),
    };
  }


  async findOne(id: number) {
    const role =
      await this.roles.findOne({
        where: {
          id,
        },
      });

    if (!role) {
      throw new NotFoundException(
        'Role not found',
      );
    }

    return role;
  }

  /** Same lookup as `findOne`, keyed by `roleName` instead of numeric id — for callers that need to
   *  resolve a well-known role by its name constant (e.g. `ROLES.SUPER_ADMIN`) without first knowing
   *  its id. Unlike `findOne`, returns `null` rather than throwing when no such role exists — an
   *  install that has no SUPER_ADMIN role at all (should not happen in practice, but not this
   *  method's place to assert that) is a valid "nothing to resolve" outcome for a caller, not an
   *  error. */
  async findByName(roleName: string): Promise<Role | null> {
    return this.roles.findOne({
      where: {
        roleName,
      },
    });
  }

  /** The Role Detail page's own read — same role lookup as `findOne`, plus the two facts that page
   *  needs beyond the plain entity: how many users currently hold this role, and its user-facing
   *  display fields (userCategoryType label, matching RoleLists' own projection). Kept separate from
   *  `findOne` rather than folding this into it, since `findOne`'s other two callers
   *  (RoleController's plain GET and UserService.create/addRoles's existence check) don't need this
   *  extra query on every call — this is deliberately only for the one screen that does. */
  async findOneWithDetails(id: number) {
    // userCategory is `eager: true` on the entity, so a plain findOne already joins it — no
    // explicit `relations` needed here (same reason RoleLists' own leftJoinAndSelect would be
    // redundant, if this read ever switched to a query builder).
    const role = await this.roles.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    const assignedUsers = await this.userRoleService.getUsersByRoleId(id);

    return {
      roleId: role.id,
      roleName: role.roleName,
      roleDescription: role.roleDescription,
      userCategoryId: role.userCategoryId,
      userCategoryType: role.userCategory?.label ?? null,
      canBeReportingManager: role.canBeReportingManager,
      canBeFieldInspector: role.canBeFieldInspector,
      isSystem: this.isSystemRole(role),
      assignedUserCount: assignedUsers.length,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  async update(
    id: number,
    dto: UpdateRoleDto,
    actorId?: number,
  ) {
    const role =
      await this.findOne(id);

    // Same rationale as the SUPER_ADMIN guard in remove() just above, and in
    // RolePermissionsService.updateRolePermissions — this is a SEPARATE route (PATCH /roles/:id,
    // reachable independently of the Edit Role screen's own save flow) that would otherwise let
    // SUPER_ADMIN's roleName be changed with no protection at all, stranding RolesGuard's bypass and
    // every ensureAdminPolicyGrants/ensureAdminGrants/ensureSuperAdminGrant reconciliation query —
    // all of which match this role by this exact literal string.
    if (
      role.roleName === ROLES.SUPER_ADMIN &&
      dto.roleName !== undefined &&
      dto.roleName !== ROLES.SUPER_ADMIN
    ) {
      throw new ConflictException(
        "SUPER_ADMIN's role name is relied on throughout the system and cannot be changed.",
      );
    }

    const oldValue = {
      ...role,
    };

    const exists =
      await this.roles.findOne({
        where: {
          roleName:
            dto.roleName ??
            role.roleName,
        },
      });

    if (
      exists &&
      exists.id !== role.id
    ) {
      throw new ConflictException(
        'Role already exists',
      );
    }

    role.roleName =
      dto.roleName ??
      role.roleName;

    role.roleDescription =
      dto.roleDescription ??
      role.roleDescription;

    role.userCategoryId =
      dto.userCategoryId ??
      role.userCategoryId;

    role.canBeReportingManager =
      dto.canBeReportingManager ??
      role.canBeReportingManager;

    const saved =
      await this.roles.save(role);

    await this.audit.record({
      moduleName: 'roles',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: saved,
      performedBy: actorId,
    });

    return saved;
  }

  /**
   * Guards against every EXTERNAL dependent before deleting — a role's own grants
   * (role_permissions/role_policies) are NOT checked here and are expected to go away with it,
   * same as a Policy's own statements disappear with that Policy (see IamService.removePolicy's
   * identical "blocked only by what else depends on it" convention). What IS checked, each with
   * its own clear error rather than a raw FK violation:
   *   - user_roles: a user actually holding this role today.
   *   - workflow_approval_levels / workflow_definition_levels: this role configured as an approver.
   *   - workflow_instance_steps: an in-progress workflow step referencing this role (also the one
   *     case the DB's own FK — RESTRICT, not CASCADE — would otherwise have caught, just as a raw,
   *     unexplained SQL error instead of this message).
   * Soft-deleted (softRemove), not the hard remove() this replaced — that hard delete combined with
   * every other FK here being ON DELETE CASCADE meant deleting a role with users still assigned to
   * it silently deleted their user_roles rows too (instant, unexplained, unrecoverable lockout) the
   * moment it slipped past a guard. Soft delete never triggers those cascades at all, so this is a
   * second, independent layer of safety under the explicit checks above, not a replacement for them.
   */
  async remove(
    id: number,
    actorId?: number,
  ) {
    const role =
      await this.findOne(id);

    // SUPER_ADMIN is the system's one true root role — RolesGuard bypasses every @Roles(...) check
    // for it by this exact name (common/guards/roles.guard.ts), and ensureAdminPolicyGrants/
    // ensureAdminGrants re-grant it every active action on every boot by this exact name too. Deleting
    // it (even with zero assigned users, e.g. right after reassigning the bootstrap admin elsewhere)
    // would permanently remove the one role those mechanisms depend on existing, with nothing left to
    // reconcile into on the next restart. None of the checks below would have caught this on their own.
    if (role.roleName === ROLES.SUPER_ADMIN) {
      throw new ConflictException(
        'SUPER_ADMIN is a system-managed role and cannot be deleted.',
      );
    }

    const assignedUsers = await this.userRoleService.getUsersByRoleId(id);
    if (assignedUsers.length > 0) {
      throw new ConflictException(
        `This role is assigned to ${assignedUsers.length} user${assignedUsers.length === 1 ? '' : 's'} — reassign them to a different role before deleting it.`,
      );
    }

    const [{ count: approverCount }] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*) FROM workflow_approval_levels WHERE roleId = ?) +
         (SELECT COUNT(*) FROM workflow_definition_levels WHERE roleId = ?) AS count`,
      [id, id],
    );
    if (Number(approverCount) > 0) {
      throw new ConflictException(
        'This role is configured as an approver in one or more approval workflows — remove it from those workflows before deleting it.',
      );
    }

    const [{ count: stepCount }] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM workflow_instance_steps WHERE roleId = ?`,
      [id],
    );
    if (Number(stepCount) > 0) {
      throw new ConflictException(
        'This role is referenced by an in-progress workflow step and cannot be deleted while that workflow is active.',
      );
    }

    // softRemove is an UPDATE (sets deleted_at), never a DELETE — so the table's own ON DELETE
    // CASCADE foreign keys (the exact thing this method exists to avoid triggering) never fire.
    // That also means role_policies/role_permissions rows are NOT auto-cleaned by the database, so
    // they're explicitly removed here, in the same transaction as the soft-delete: left alone, a
    // deleted role would keep showing up as a real, attached entity on every Policy it still held
    // (IamService.getRolesForPolicy's LEFT JOIN has no reason to filter out a soft-deleted Role).
    // Hard-deleted, not soft — these are pure junction/grant rows with nothing else pointing at
    // them, the role's own config rather than a record of anything else, same as a Policy's own
    // statements are expected to go away with it.
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM role_policies WHERE roleId = ?`, [id]);
      await manager.query(`DELETE FROM role_permissions WHERE roleId = ?`, [id]);
      await manager.getRepository(Role).softRemove(role);
    });

    await this.audit.record({
      moduleName: 'roles',
      entityId: id,
      action: 'DELETE',
      oldValue: role,
      performedBy: actorId,
    });

    return {
      message:
        'Role deleted successfully',
    };
  }
}