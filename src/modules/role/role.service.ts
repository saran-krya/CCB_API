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
          userCategoryId:
            dto.userCategoryId,
          userTypeId:
            dto.userTypeId,
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
      userTypeId:
        dto.userTypeId,
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

    qb.leftJoinAndSelect(
      "role.userType",
      "userType",
    );

    // Sorting

    switch (query.sortBy) {
      case "userCategory":
        qb.orderBy(
          "userCategory.label",
          query.sortOrder,
        );
        break;

      case "userType":
        qb.orderBy(
          "userType.label",
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

    if (query["search.roleName"]) {
      qb.andWhere(
        "role.roleName LIKE :roleName",
        {
          roleName: `%${query["search.roleName"]}%`,
        },
      );
    }

    // Filter - User Category (ID-based)

    if (query.userCategoryId) {
      qb.andWhere(
        "role.userCategoryId = :userCategoryId",
        { userCategoryId: query.userCategoryId },
      );
    }

    // Filter - User Type (ID-based)

    if (query.userTypeId) {
      qb.andWhere(
        "role.userTypeId = :userTypeId",
        { userTypeId: query.userTypeId },
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
          userType:
            role.userType
              ?.label ?? null,
          created:
            role.createdAt,
        }),
      ),
      pagination:
        result.pagination,
    };
  }

  async getRoleDropdown(
    userCategoryId: number,
    userTypeId: number,
  ) {
    const roles = await this.roles
      .createQueryBuilder('role')
      .select([
        'role.id',
        'role.roleName',
      ])
      .where(
        'role.userCategoryId = :userCategoryId',
        { userCategoryId },
      )
      .andWhere(
        'role.userTypeId = :userTypeId',
        { userTypeId },
      )
      .orderBy(
        'role.roleName',
        'ASC',
      )
      .getMany();

    return roles.map((role) => ({
      id: role.id,
      name: role.roleName,
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
    const [userCategories, userTypes] = await Promise.all([
      this.lovService.findByCategory('USER_CATEGORY'),
      this.lovService.findByCategory('USER_TYPE'),
    ]);

    return {
      userCategories: userCategories.map((lv) => ({ id: lv.id, name: lv.label })),
      userTypes: userTypes.map((lv) => ({ id: lv.id, name: lv.label })),
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

          userCategoryId:
            dto.userCategoryId ??
            role.userCategoryId,

          userTypeId:
            dto.userTypeId ??
            role.userTypeId,
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

    role.userTypeId =
      dto.userTypeId ??
      role.userTypeId;

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