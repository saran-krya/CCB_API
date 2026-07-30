import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/utils/pagination.util';

import {
  CreateRoleDto,
  UpdateRoleDto,
} from './dto/create-role.dto';

import { Role } from './entities/role.entity';
import { RoleQueryDto } from '@app/common/dto/role-paginatoin.dto';
import { LovService } from '../lov/lov.service';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roles: Repository<Role>,

    private readonly lovService: LovService,

    private readonly audit: AuditService,
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

    // Sorting

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

    // Search - Role Name
    // A multiselect on the frontend sends multiple exact names as a
    // comma-separated list — matched with IN. A single value (whether typed
    // free-text or one multiselect pick) still uses LIKE, so this covers both
    // without changing the param shape ("search.roleName" stays a string).

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

    // Filter - User Category (ID-based)

    if (query.userCategoryId) {
      qb.andWhere(
        "role.userCategoryId = :userCategoryId",
        { userCategoryId: query.userCategoryId },
      );
    }

    // Search - Created Date

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
        }),
      ),
      pagination:
        result.pagination,
    };
  }

  // userCategoryId is an optional filter, not a required cascade — Role is
  // the only thing a User Creation form picks directly; Scope is a read-only
  // fact inherited from that Role, not a separate selection the caller
  // narrows by beforehand. Omitting it returns every active role so the
  // frontend can show Scope as derived display text.
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

  async remove(
    id: number,
    actorId?: number,
  ) {
    const role =
      await this.findOne(id);

    await this.roles.remove(
      role,
    );

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