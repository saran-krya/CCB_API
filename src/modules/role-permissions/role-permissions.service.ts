import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { paginate } from '@app/common/utils/pagination.util';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  CreateRolePermissionDto,

} from './dto/create-role-permission.dto';
import { RolePermission } from './entities/role-permission.entity';
import { Role } from '../role/entities/role.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';
import { Action } from '../actions/entities/action.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';
import { Screen } from '../screens/entities/screen.entity';
import { SaveRoleWithPermissionsDto } from './dto/save-role-with-permissions.dto';

@Injectable()
export class RolePermissionsService {
  constructor(
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,

    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,

    @InjectRepository(SubModule)
    private readonly subModuleRepository: Repository<SubModule>,

    @InjectRepository(Action)
    private readonly actionRepository: Repository<Action>,

    @InjectRepository(PModule)
    private readonly pModuleRepository: Repository<PModule>,

    @InjectRepository(Screen)
    private readonly screenRepository: Repository<Screen>,



  ) { }

  async create(dto: CreateRolePermissionDto) {
    const role = await this.roleRepository.findOne({
      where: { id: dto.roleId },
    });

    if (!role) {
      throw new NotFoundException(
        'Role not found',
      );
    }

    const subModule =
      await this.subModuleRepository.findOne({
        where: {
          id: dto.subModuleId,
        },
      });

    if (!subModule) {
      throw new NotFoundException(
        'Sub module not found',
      );
    }

    const action =
      await this.actionRepository.findOne({
        where: {
          id: dto.actionId,
        },
      });

    if (!action) {
      throw new NotFoundException(
        'Action not found',
      );
    }

    const exists =
      await this.rolePermissionRepository.findOne({
        where: {
          roleId: dto.roleId,
          subModuleId: dto.subModuleId,
          actionId: dto.actionId,
        },
      });

    if (exists) {
      throw new ConflictException(
        'Permission already exists',
      );
    }

    const permission =
      this.rolePermissionRepository.create(dto);

    return this.rolePermissionRepository.save(
      permission,
    );
  }

  async savePermissions(
    dto: SaveRoleWithPermissionsDto,
  ) {
    const existingRole =
      await this.roleRepository.findOne({
        where: {
          roleName: dto.roleName,
        },
      });

    if (existingRole) {
      throw new ConflictException(
        'Role already exists',
      );
    }

    const role =
      await this.roleRepository.save(
        this.roleRepository.create({
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
        }),
      );

    await this.rolePermissionRepository.delete({
      roleId: role.id,
    });

    const permissions: RolePermission[] =
      [];

    for (const module of dto.screenPermissionList ?? []) {
      const hasSubModules = module.subModule && module.subModule.length > 0;
      const hasDirectScreens = module.screens && module.screens.length > 0;

      // Module-only access (no subModules and no direct screens)
      if (module.hasAccess && !hasSubModules && !hasDirectScreens) {
        permissions.push(
          this.rolePermissionRepository.create({ roleId: role.id, moduleId: module.moduleId }),
        );
      }

      // Scenario 1: SubModule → Screen → Action
      for (const subModule of module.subModule ?? []) {
        if (subModule.hasAccess && (!subModule.screens || subModule.screens.length === 0)) {
          permissions.push(
            this.rolePermissionRepository.create({
              roleId: role.id,
              moduleId: module.moduleId,
              subModuleId: subModule.subModuleId,
            }),
          );
        }

        for (const screen of subModule.screens ?? []) {
          if (screen.hasAccess && (!screen.actions || screen.actions.length === 0)) {
            permissions.push(
              this.rolePermissionRepository.create({
                roleId: role.id,
                moduleId: module.moduleId,
                subModuleId: subModule.subModuleId,
                screenId: screen.screenId,
              }),
            );
          }

          for (const action of screen.actions ?? []) {
            if (!action.hasAccess) continue;
            permissions.push(
              this.rolePermissionRepository.create({
                roleId: role.id,
                moduleId: module.moduleId,
                subModuleId: subModule.subModuleId,
                screenId: screen.screenId,
                actionId: action.actionId,
              }),
            );
          }
        }
      }

      // Scenario 2: direct Screen → Action (no SubModule)
      for (const screen of module.screens ?? []) {
        if (screen.hasAccess && (!screen.actions || screen.actions.length === 0)) {
          permissions.push(
            this.rolePermissionRepository.create({
              roleId: role.id,
              moduleId: module.moduleId,
              screenId: screen.screenId,
            }),
          );
        }

        for (const action of screen.actions ?? []) {
          if (!action.hasAccess) continue;
          permissions.push(
            this.rolePermissionRepository.create({
              roleId: role.id,
              moduleId: module.moduleId,
              screenId: screen.screenId,
              actionId: action.actionId,
            }),
          );
        }
      }
    }

    if (permissions.length > 0) {
      await this.rolePermissionRepository.save(
        permissions,
      );
    }

    return {
      message:
        'Role and permissions saved successfully',
      roleId: role.id,
      count:
        permissions.length,
    };
  }
  // async findAll(
  //   query: PaginationQueryDto,
  // ) {
  //   const qb =
  //     this.rolePermissionRepository.createQueryBuilder(
  //       'rolePermission',
  //     );

  //   qb.leftJoinAndSelect(
  //     'rolePermission.role',
  //     'role',
  //   );

  //   qb.leftJoinAndSelect(
  //     'rolePermission.subModule',
  //     'subModule',
  //   );

  //   qb.leftJoinAndSelect(
  //     'rolePermission.action',
  //     'action',
  //   );

  //   return paginate(qb, query);
  // }

  // async findOne(id: number) {
  //   const permission =
  //     await this.rolePermissionRepository.findOne({
  //       where: { id },
  //       relations: {
  //         role: true,
  //         subModule: true,
  //         action: true,
  //       },
  //     });

  //   if (!permission) {
  //     throw new NotFoundException(
  //       'Role permission not found',
  //     );
  //   }

  //   return permission;
  // }

  async getUserPermissions(roleId: number) {
    const tree = await this.getPermissionTree(roleId);

    return tree.screenPermissionList
      .filter((module) => module.hasAccess)
      .map((module) => ({
        ...module,

        // Scenario 1: SubModule → Screen path
        subModule: module.subModule
          .filter((sub) => sub.hasAccess)
          .map((sub) => ({
            ...sub,
            screens: sub.screens
              .filter((screen) => screen.hasAccess)
              .map((screen) => ({
                ...screen,
                actions: screen.actions.filter((action) => action.hasAccess),
              })),
          })),

        // Scenario 2: direct Screen path
        screens: module.screens
          .filter((screen) => screen.hasAccess)
          .map((screen) => ({
            ...screen,
            actions: screen.actions.filter((action) => action.hasAccess),
          })),
      }));
  }

  async getAllMenus() {
    const tree = await this.getPermissionTree();

    const grantAll = (screen: { hasAccess: boolean; actions: { hasAccess: boolean }[] }) => ({
      ...screen,
      hasAccess: true,
      actions: screen.actions.map((action) => ({ ...action, hasAccess: true })),
    });

    return tree.screenPermissionList.map((module) => ({
      ...module,
      hasAccess: true,

      subModule: module.subModule.map((sub) => ({
        ...sub,
        hasAccess: true,
        screens: sub.screens.map(grantAll),
      })),

      screens: module.screens.map(grantAll),
    }));
  }

  async getPermissionTree(roleId?: number) {
    const role = roleId
      ? await this.roleRepository.findOne({ where: { id: roleId } })
      : null;

    const modules = await this.pModuleRepository.find({
      order: { displayOrder: 'ASC' },
    });
    const subModules = await this.subModuleRepository.find();
    const screens = await this.screenRepository.find();
    const actions = await this.actionRepository.find();

    const permissions = roleId
      ? await this.rolePermissionRepository.find({ where: { roleId } })
      : [];

    const buildActions = (screenId: number) =>
      actions
        .filter((a) => a.screenId === screenId)
        .map((a) => ({
          actionId: a.id,
          actionName: a.name,
          code: a.code,
          hasAccess: permissions.some((p) => p.actionId === a.id),
        }));

    const buildScreen = (screen: typeof screens[0]) => ({
      screenId: screen.id,
      code: screen.code,
      screenName: screen.name,
      url: screen.url,
      hasAccess: permissions.some((p) => p.screenId === screen.id),
      actions: buildActions(screen.id),
    });

    return {
      roleId: role?.id ?? null,
      roleName: role?.roleName ?? null,
      roleDescription: null,
      userCategoryId: role?.userCategoryId ?? null,
      userTypeId: role?.userTypeId ?? null,
      userId: 0,

      screenPermissionList: modules.map((module) => ({
        moduleId: module.id,
        moduleName: module.moduleName,
        displayOrder: module.displayOrder,
        icon: module.icon,
        url: module.url,
        code: module.code,
        hasAccess: permissions.some((p) => p.moduleId === module.id),

        // Scenario 1: PModule → SubModule → Screen → Actions
        subModule: subModules
          .filter((s) => s.pModuleId === module.id)
          .map((subModule) => ({
            subModuleId: subModule.id,
            code: subModule.code,
            subModuleName: subModule.name,
            icon: subModule.icon,
            url: subModule.url,
            displayOrder: subModule.displayOrder,
            addFlag: false,
            hasAccess: permissions.some((p) => p.subModuleId === subModule.id),
            screens: screens
              .filter((s) => s.subModuleId === subModule.id)
              .map(buildScreen),
            fields: [],
          })),

        // Scenario 2: PModule → Screen → Actions (no SubModule)
        screens: screens
          .filter((s) => s.pModuleId === module.id)
          .map(buildScreen),
      })),
    };
  }

  async updateRolePermissions(
    roleId: number,
    dto: SaveRoleWithPermissionsDto,
  ) {
    const role =
      await this.roleRepository.findOne({
        where: { id: roleId },
      });

    if (!role) {
      throw new NotFoundException(
        "Role not found",
      );
    }

    Object.assign(role, {
      roleName: dto.roleName,
      roleDescription:
        dto.roleDescription,
      userCategoryId:
        dto.userCategoryId,
      userTypeId:
        dto.userTypeId,
      canBeReportingManager:
        dto.canBeReportingManager,
    });

    await this.roleRepository.save(role);

    await this.rolePermissionRepository.delete({
      roleId,
    });

    const permissions: RolePermission[] =
      [];

    for (const module of dto.screenPermissionList ?? []) {
      const hasSubModules = module.subModule && module.subModule.length > 0;
      const hasDirectScreens = module.screens && module.screens.length > 0;

      // Module-only access (no subModules and no direct screens)
      if (module.hasAccess && !hasSubModules && !hasDirectScreens) {
        permissions.push(
          this.rolePermissionRepository.create({ roleId, moduleId: module.moduleId }),
        );
      }

      // Scenario 1: SubModule → Screen → Action
      for (const subModule of module.subModule ?? []) {
        if (subModule.hasAccess && (!subModule.screens || subModule.screens.length === 0)) {
          permissions.push(
            this.rolePermissionRepository.create({
              roleId,
              moduleId: module.moduleId,
              subModuleId: subModule.subModuleId,
            }),
          );
        }

        for (const screen of subModule.screens ?? []) {
          if (screen.hasAccess && (!screen.actions || screen.actions.length === 0)) {
            permissions.push(
              this.rolePermissionRepository.create({
                roleId,
                moduleId: module.moduleId,
                subModuleId: subModule.subModuleId,
                screenId: screen.screenId,
              }),
            );
          }

          for (const action of screen.actions ?? []) {
            if (!action.hasAccess) continue;
            permissions.push(
              this.rolePermissionRepository.create({
                roleId,
                moduleId: module.moduleId,
                subModuleId: subModule.subModuleId,
                screenId: screen.screenId,
                actionId: action.actionId,
              }),
            );
          }
        }
      }

      // Scenario 2: direct Screen → Action (no SubModule)
      for (const screen of module.screens ?? []) {
        if (screen.hasAccess && (!screen.actions || screen.actions.length === 0)) {
          permissions.push(
            this.rolePermissionRepository.create({
              roleId,
              moduleId: module.moduleId,
              screenId: screen.screenId,
            }),
          );
        }

        for (const action of screen.actions ?? []) {
          if (!action.hasAccess) continue;
          permissions.push(
            this.rolePermissionRepository.create({
              roleId,
              moduleId: module.moduleId,
              screenId: screen.screenId,
              actionId: action.actionId,
            }),
          );
        }
      }
    }

    if (permissions.length > 0) {
      await this.rolePermissionRepository.save(
        permissions,
      );
    }

    return {
      message:
        "Role updated successfully",
      roleId,
      count: permissions.length,
    };
  }
  // async update(
  //   id: number,
  //   dto: UpdateRolePermissionDto,
  // ) {
  //   const permission =
  //     await this.findOne(id);

  //   Object.assign(permission, dto);

  //   return this.rolePermissionRepository.save(
  //     permission,
  //   );
  // }

  // async remove(id: number) {
  //   const permission =
  //     await this.findOne(id);

  //   await this.rolePermissionRepository.softRemove(
  //     permission,
  //   );

  //   return {
  //     message:
  //       'Role permission deleted successfully',
  //   };
  // }
}