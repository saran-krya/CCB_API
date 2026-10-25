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

import { Role } from './entities/role.entity';
import { RoleQueryDto } from '@app/common/dto/role-paginatoin.dto';
import { LovService } from '../lov/lov.service';
import { UserRoleService } from '../user-role/user-role.service';

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

  async RoleLists(
    query: RoleQueryDto,
  ) {
    const qb =
      this.roles.createQueryBuilder(
        "role",
      );

    qb.leftJoinAndSelect(
      "role.userCategory",
      "userCategory",
    );


    switch (query.sortBy) {
      case "userCategory":
        qb.orderBy(
          "userCategory.label",
          query.sortOrder,
        );
        break;

      case "roleName":
        qb.orderBy(
          "role.roleName",
          query.sortOrder,
        );
        break;

      case "createdAt":
      default:
        qb.orderBy(
          "role.createdAt",
          query.sortOrder,
        );
        break;
    }


    if (query["search.roleName"]) {
      const roleNames = query["search.roleName"]
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);

      if (roleNames.length > 1) {
        qb.andWhere("role.roleName IN (:...roleNames)", { roleNames });
      } else if (roleNames.length === 1) {
        qb.andWhere(
          "role.roleName LIKE :roleName",
          {
            roleName: `%${roleNames[0]}%`,
          },
        );
      }
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
        {
          createdAt:
            query["search.createdAt"],
        },
      );
    }

    const result =
      await paginate(
        qb,
        query,
      );

    // One grouped query for the whole page's "assigned users" count, not one query per row —
    // see UserRoleService.getUserCountsByRoleIds's own doc comment on why this avoids N+1.
    const userCounts = await this.userRoleService.getUserCountsByRoleIds(
      result.items.map((role) => role.id),
    );

    return {
      items: result.items.map(
        (role) => ({
          roleId: role.id,
          roleName:
            role.roleName,
          roleDescription:
            role.roleDescription,
          userCategoryType:
            role.userCategory
              ?.label ?? null,
          created:
            role.createdAt,
          assignedUserCount:
            userCounts.get(role.id) ?? 0,
        }),
      ),
      pagination:
        result.pagination,
    };
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
    }));
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

  /** The Role Detail page's own read — same role lookup as `findOne`, plus the two facts that page
   *  needs beyond the plain entity: how many users currently hold this role, and its user-facing
   *  display fields (userCategoryType label, matching RoleLists' own projection). Kept separate from
   *  `findOne` rather than folding this into it, since `findOne`'s other two callers
   *  (RoleController's plain GET and UserService.create/update's existence check) don't need this
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