import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/utils/pagination.util';
import { releaseSoftDeletedUnique } from '../../common/utils/release-soft-deleted-unique';
import { Actor, actorUserId, isSuperAdminActor } from '../../common/security/actor';
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
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { AUDIT_MODULE, AUDIT_ACTION } from '../../audit/audit.constants';
import { SORT_ORDER } from '../../common/constants/sort.constants';
import { LOV_CATEGORY } from '../lov/lov.constants';

/** The one role name with system meaning. SUPER_ADMIN is the ONLY predefined role: RolesGuard's bypass and the
 *  boot-time grant reconciliation (ensureAdminPolicyGrants, ensureAdminGrants) match it by this exact name. It is
 *  created by the boot-time seed only — through the API it can be neither created, renamed into, renamed away from
 *  nor deleted, so a delegated administrator cannot manufacture, hijack or dismantle it by renaming roles. Every
 *  other role is created and managed dynamically by SUPER_ADMIN: no other name is special, reserved or auto-granted
 *  anything. */
const RESERVED_ROLE_NAMES: readonly string[] = [ROLES.SUPER_ADMIN];

/** The comparison key of a role name: Unicode-normalised (a full-width spelling or a composed/decomposed
 *  accent is the same string), accents and invisible/control characters removed, trimmed, upper-cased. The
 *  database compares role names case- and accent-insensitively and the boot-time reconciliation looks the
 *  system role up by name IN SQL, so a look-alike such as "SÜPER_ADMIN" or "super_admín" would be taken for
 *  SUPER_ADMIN there — it must count as reserved here. Deliberately a little broader than the database, never
 *  narrower. */
export const canonicalRoleName = (name: string): string =>
  name.normalize('NFKD').replace(/[\p{M}\p{Cc}\p{Cf}]/gu, '').trim().toUpperCase();

const RESERVED_CANONICAL_NAMES: ReadonlySet<string> = new Set(RESERVED_ROLE_NAMES.map(canonicalRoleName));
const isReservedRoleName = (name: string | undefined): boolean =>
  name !== undefined && RESERVED_CANONICAL_NAMES.has(canonicalRoleName(name));

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
    const roleName = dto.roleName.trim();
    if (isReservedRoleName(roleName)) {
      throw new ForbiddenException(
        `"${roleName}" is a reserved system role name and cannot be created.`,
      );
    }

    const existingRole =
      await this.roles.findOne({
        where: {
          roleName,
        },
      });

    if (existingRole) {
      throw new ConflictException(
        ERROR_MESSAGES.ROLE_ALREADY_EXISTS,
      );
    }

    const role = this.roles.create({
      roleName,
      roleDescription:
        dto.roleDescription,
      userCategoryId:
        dto.userCategoryId,
      canBeReportingManager:
        dto.canBeReportingManager ??
        false,
    });

    // A deleted role keeps its name reserved at the database index; release it so the name is reusable.
    const saved = await this.dataSource.transaction(async (manager) => {
      await releaseSoftDeletedUnique(manager, Role, 'roleName', roleName);
      return manager.getRepository(Role).save(role);
    });

    await this.audit.record({
      moduleName: AUDIT_MODULE.ROLES,
      entityId: saved.id,
      action: AUDIT_ACTION.CREATE,
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

    const direction = query.sortOrder === SORT_ORDER.ASC ? SORT_ORDER.ASC : SORT_ORDER.DESC;
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
    if (sortColumn !== sortColumns.roleName) qb.addOrderBy("role.roleName", SORT_ORDER.ASC);

    const [result, userCategories] = await Promise.all([
      paginate(qb, query),
      this.lovService.findByCategory(LOV_CATEGORY.USER_CATEGORY),
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

  /** The system-managed role (SUPER_ADMIN, the only predefined one): RolesGuard's bypass and the boot-time grant
   *  reconciliation match it by exact name, so it can be neither renamed nor deleted. */
  private isSystemRole(role: Pick<Role, "roleName">): boolean {
    return isReservedRoleName(role.roleName);
  }

  /** Whether the signed-in user may hand this role out in Create User / Assign Roles. SUPER_ADMIN is
   *  listed for everyone but only a SUPER_ADMIN may assign it — the same rule UserRoleService enforces
   *  on the write, so the web app can show the option disabled instead of letting a request fail. */
  private assignability(role: Pick<Role, "roleName">, actor?: Actor): { assignable: boolean; assignableReason: string | null } {
    const restricted = role.roleName === ROLES.SUPER_ADMIN;
    const allowed = !restricted || (actor !== undefined && isSuperAdminActor(actor));
    return { assignable: allowed, assignableReason: allowed ? null : 'Only SUPER_ADMIN can assign this role.' };
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
    actor?: Actor,
  ) {
    const qb = this.roles
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.userCategory', 'userCategory');

    if (userCategoryId) {
      qb.andWhere('role.userCategoryId = :userCategoryId', { userCategoryId });
    }

    const roles = await qb.orderBy('role.roleName', SORT_ORDER.ASC).getMany();

    // The Roles picker on Create / Edit User shows how many users hold each role. Same batched count the Roles
    // list uses for "Assigned Users" — one grouped query for the whole list, never one per role.
    const userCounts = await this.userRoleService.getUserCountsByRoleIds(roles.map((role) => role.id));

    return roles.map((role) => ({
      id: role.id,
      name: role.roleName,
      // Additive field — Create User's "Set permissions" step shows this short description when
      // picking a role (AWS IAM-inspired redesign). Deliberately extending this already-reachable-
      // by-this-page dropdown endpoint rather than adding a call to a more restrictively-guarded
      // one (GET /roles/:id needs VIEW_ROLE, which not everyone who can open Create / Edit User holds, and the
      // role-policies endpoints are SUPER_ADMIN-only), so this keeps working for
      // whichever role the page's own CREATE_USER/EDIT_USER permission is actually granted to.
      description: role.roleDescription ?? null,
      userCategoryId: role.userCategoryId,
      userCategoryLabel: role.userCategory?.label ?? null,
      canBeReportingManager: role.canBeReportingManager,
      assignedUserCount: userCounts.get(role.id) ?? 0,
      ...this.assignability(role, actor),
    }));
  }

  /** The Roles picker on Create / Edit User: the same rows as getRoleDropdown, but searched, filtered by
   *  User Category, sorted and paged here — the web client sends only the query and renders the page. The
   *  "Filter by Type" options ride along in `meta` so the client never hardcodes which categories exist.
   *  The user count is a correlated subquery exposed as a selected alias (one row per role, and an alias
   *  is what TypeORM can order a skip/take page by). Each row says whether the signed-in user may assign
   *  it (`assignable`) — SUPER_ADMIN is shown to everyone but is assignable only by a SUPER_ADMIN. */
  async getRolePicker(query: RolePickerQueryDto, actor?: Actor) {
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

    const direction = query.sortOrder === SORT_ORDER.DESC ? SORT_ORDER.DESC : SORT_ORDER.ASC;
    const sortColumn =
      query.sortBy === 'users' ? 'assigned_user_count' : query.sortBy === 'type' ? 'userCategory.label' : 'role.roleName';
    qb.orderBy(sortColumn, direction);
    // Ties fall back to the name so the order never jumps between requests.
    if (sortColumn !== 'role.roleName') qb.addOrderBy('role.roleName', SORT_ORDER.ASC);

    const [page, userCategories] = await Promise.all([
      paginate(qb, query),
      this.lovService.findByCategory(LOV_CATEGORY.USER_CATEGORY),
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
        ...this.assignability(role, actor),
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
        SORT_ORDER.ASC,
      )
      .getMany();

    return roles.map((role) => ({
      id: role.id,
      name: role.roleName,
    }));
  }

  async getFilterMetadata() {
    const userCategories = await this.lovService.findByCategory(LOV_CATEGORY.USER_CATEGORY);

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
        ERROR_MESSAGES.ROLE_NOT_FOUND,
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
      throw new NotFoundException(ERROR_MESSAGES.ROLE_NOT_FOUND);
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
    actor: Actor,
  ) {
    const role =
      await this.findOne(id);
    // The name that will be stored: trimmed (defence in depth — the DTO already trims requests).
    const requestedName = dto.roleName?.trim();

    // The reserved system role (SUPER_ADMIN — the only predefined role) is matched BY NAME throughout the system —
    // RolesGuard's bypass and the ensureAdminPolicyGrants/ensureAdminGrants reconciliation queries — and
    // PATCH /roles/:id is a route reachable independently of the Edit Role screen's own save flow. So its name can
    // never change, and (because EDIT_ROLE is a delegable permission) only a SUPER_ADMIN may edit it at all.
    if (isReservedRoleName(role.roleName)) {
      if (!isSuperAdminActor(actor)) {
        throw new ForbiddenException(`${role.roleName} is a system role — only SUPER_ADMIN can edit it.`);
      }
      if (requestedName !== undefined && requestedName !== role.roleName) {
        throw new ConflictException(
          `${role.roleName}'s role name is relied on throughout the system and cannot be changed.`,
        );
      }
    }
    // ...and no other role may be renamed INTO the reserved name (or a look-alike of it): RolesGuard's bypass and the
    // boot-time reconciliation recognise SUPER_ADMIN by name, so that rename would be a privilege escalation.
    if (
      requestedName !== undefined &&
      isReservedRoleName(requestedName) &&
      canonicalRoleName(requestedName) !== canonicalRoleName(role.roleName)
    ) {
      throw new ForbiddenException(`"${requestedName}" is a reserved system role name.`);
    }

    const oldValue = {
      ...role,
    };

    const exists =
      await this.roles.findOne({
        where: {
          roleName:
            requestedName ??
            role.roleName,
        },
      });

    if (
      exists &&
      exists.id !== role.id
    ) {
      throw new ConflictException(
        ERROR_MESSAGES.ROLE_ALREADY_EXISTS,
      );
    }

    role.roleName =
      requestedName ??
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

    const saved = await this.dataSource.transaction(async (manager) => {
      // Free the new name if a deleted role still holds it at the unique index.
      await releaseSoftDeletedUnique(manager, Role, 'roleName', role.roleName, { exceptId: id });
      return manager.getRepository(Role).save(role);
    });

    await this.audit.record({
      moduleName: AUDIT_MODULE.ROLES,
      entityId: id,
      action: AUDIT_ACTION.UPDATE,
      oldValue,
      newValue: saved,
      performedBy: actorUserId(actor),
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
    // ensureAdminGrants re-grant it every active action it may hold on every boot by this exact name too. Deleting
    // it (even with zero assigned users, e.g. right after reassigning the bootstrap admin elsewhere)
    // would permanently remove the one role those mechanisms depend on existing, with nothing left to
    // reconcile into on the next restart. None of the checks below would have caught this on their own.
    // It is the ONLY predefined role, hence the only reserved one.
    if (isReservedRoleName(role.roleName)) {
      throw new ConflictException(
        `${role.roleName} is a system-managed role and cannot be deleted.`,
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
      // The role's OWN inline policies (and, through the FK cascade, their statements) belong to it alone:
      // left behind they would be orphaned rows pointing at a deleted role.
      await manager.query(`DELETE FROM role_inline_policies WHERE roleId = ?`, [id]);
      await manager.getRepository(Role).softRemove(role);
    });

    await this.audit.record({
      moduleName: AUDIT_MODULE.ROLES,
      entityId: id,
      action: AUDIT_ACTION.DELETE,
      oldValue: role,
      performedBy: actorId,
    });

    return {
      message:
        'Role deleted successfully',
    };
  }
}