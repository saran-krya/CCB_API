import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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
  private readonly logger = new Logger(RolePermissionsService.name);

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

      if (module.hasAccess && !hasSubModules && !hasDirectScreens) {
        permissions.push(
          this.rolePermissionRepository.create({ roleId: role.id, moduleId: module.moduleId }),
        );
      }

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
            if (action.hasAccess) {
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

            for (const child of action.children ?? []) {
              if (!child.hasAccess) continue;
              permissions.push(
                this.rolePermissionRepository.create({
                  roleId: role.id,
                  moduleId: module.moduleId,
                  subModuleId: subModule.subModuleId,
                  screenId: screen.screenId,
                  actionId: child.actionId,
                }),
              );
            }
          }
        }
      }

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
          if (action.hasAccess) {
            permissions.push(
              this.rolePermissionRepository.create({
                roleId: role.id,
                moduleId: module.moduleId,
                screenId: screen.screenId,
                actionId: action.actionId,
              }),
            );
          }

          for (const child of action.children ?? []) {
            if (!child.hasAccess) continue;
            permissions.push(
              this.rolePermissionRepository.create({
                roleId: role.id,
                moduleId: module.moduleId,
                screenId: screen.screenId,
                actionId: child.actionId,
              }),
            );
          }
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

  async getUserPermissions(roleId: number) {
    const tree = await this.getPermissionTree(roleId);

    const pruned = tree.screenPermissionList
      .filter((module) => module.hasAccess)
      .map((module) => ({
        ...module,

        subModule: module.subModule
          .filter((sub) => sub.hasAccess)
          .map((sub) => ({
            ...sub,
            screens: sub.screens
              .filter((screen) => screen.hasAccess)
              .map((screen) => ({
                ...screen,
                actions: screen.actions
                  .filter((action) => action.hasAccess)
                  .map((action) => ({
                    ...action,
                    children: (action.children ?? []).filter((c) => c.hasAccess),
                  })),
              })),
          })),

        screens: module.screens
          .filter((screen) => screen.hasAccess)
          .map((screen) => ({
            ...screen,
            actions: screen.actions
              .filter((action) => action.hasAccess)
              .map((action) => ({
                ...action,
                children: (action.children ?? []).filter((c) => c.hasAccess),
              })),
          })),
      }));

    return pruned;
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

  async roleHasAction(roleId: number, actionCode: string): Promise<boolean> {
    const count = await this.rolePermissionRepository
      .createQueryBuilder('rp')
      .innerJoin(Action, 'a', 'a.id = rp.actionId')
      .where('rp.roleId = :roleId', { roleId })
      .andWhere('a.code = :actionCode', { actionCode })
      .getCount();
    return count > 0;
  }

  async ensureAdminGrants(excludedActionCodes: string[] = []): Promise<void> {
    const adminRoles = await this.roleRepository.find({
      where: [{ roleName: 'SUPER_ADMIN' }, { roleName: 'ADMIN' }],
    });
    if (!adminRoles.length) return;

    const actions = await this.actionRepository.find({
      where: { isActive: true },
      relations: { screen: { subModule: true, pModule: true } },
    });

    for (const role of adminRoles) {
      for (const action of actions) {
        try {
          if (excludedActionCodes.includes(action.code)) continue;

          const screen = action.screen;
          if (!screen) continue;

          const moduleId = screen.subModule?.pModuleId ?? screen.pModuleId;
          if (!moduleId) continue;

          const exists = await this.rolePermissionRepository.findOne({
            where: { roleId: role.id, actionId: action.id },
          });
          if (exists) continue;

          const grant = this.rolePermissionRepository.create({
            roleId: role.id,
            moduleId,
            subModuleId: screen.subModuleId ?? null,
            screenId: screen.id,
            actionId: action.id,
          });
          await this.rolePermissionRepository.save(grant);
        } catch (err) {
          this.logger.error(`Failed to grant action "${action.code}" to role "${role.roleName}" — skipping`, err as Error);
        }
      }
    }

    await this.ensureLeafModuleGrants(adminRoles);
  }

  private async ensureLeafModuleGrants(adminRoles: Role[]): Promise<void> {
    const modules = await this.pModuleRepository.find({ where: { isActive: true } });
    const subModules = await this.subModuleRepository.find({ where: { isActive: true } });
    const screens = await this.screenRepository.find({ where: { isActive: true } });

    const subModulesWithScreens = new Set(screens.map((s) => s.subModuleId).filter(Boolean));
    const modulesWithScreens = new Set(screens.map((s) => s.pModuleId).filter(Boolean));
    const modulesWithSubModules = new Set(subModules.map((s) => s.pModuleId));

    for (const role of adminRoles) {
      for (const module of modules) {
        try {
          if (modulesWithScreens.has(module.id) || modulesWithSubModules.has(module.id)) continue;

          const exists = await this.rolePermissionRepository.findOne({
            where: {
              roleId: role.id,
              moduleId: module.id,
              subModuleId: IsNull(),
              screenId: IsNull(),
            },
          });
          if (exists) continue;

          const grant = this.rolePermissionRepository.create({
            roleId: role.id,
            moduleId: module.id,
          });
          await this.rolePermissionRepository.save(grant);
        } catch (err) {
          this.logger.error(`Failed to grant leaf module "${module.code}" to role "${role.roleName}" — skipping`, err as Error);
        }
      }

      for (const subModule of subModules) {
        try {
          if (subModulesWithScreens.has(subModule.id)) continue;

          const exists = await this.rolePermissionRepository.findOne({
            where: {
              roleId: role.id,
              subModuleId: subModule.id,
              screenId: IsNull(),
            },
          });
          if (exists) continue;

          const grant = this.rolePermissionRepository.create({
            roleId: role.id,
            moduleId: subModule.pModuleId,
            subModuleId: subModule.id,
          });
          await this.rolePermissionRepository.save(grant);
        } catch (err) {
          this.logger.error(`Failed to grant leaf sub-module "${subModule.code}" to role "${role.roleName}" — skipping`, err as Error);
        }
      }
    }
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
        .filter((a) => a.screenId === screenId && a.parentActionId == null)
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        .map((a) => ({
          actionId: a.id,
          actionName: a.name,
          code: a.code,
          displayOrder: a.displayOrder,
          hasAccess: permissions.some((p) => p.actionId === a.id),
          children: actions
            .filter((c) => c.parentActionId === a.id)
            .sort((c1, c2) => (c1.displayOrder ?? 0) - (c2.displayOrder ?? 0))
            .map((c) => ({
              actionId: c.id,
              actionName: c.name,
              code: c.code,
              displayOrder: c.displayOrder,
              hasAccess: permissions.some((p) => p.actionId === c.id),
            })),
        }));

    const buildScreen = (screen: typeof screens[0]) => ({
      screenId: screen.id,
      code: screen.code,
      screenName: screen.name,
      url: screen.url,
      hasAccess: permissions.some((p) => p.screenId === screen.id),
      actions: buildActions(screen.id),
    });

    const result = {
      roleId: role?.id ?? null,
      roleName: role?.roleName ?? null,
      roleDescription: role?.roleDescription ?? null,
      userCategoryId: role?.userCategoryId ?? null,
      canBeReportingManager: role?.canBeReportingManager ?? false,
      userId: 0,

      screenPermissionList: modules.map((module) => ({
        moduleId: module.id,
        moduleName: module.moduleName,
        displayOrder: module.displayOrder,
        icon: module.icon,
        url: module.url,
        code: module.code,
        hasAccess: permissions.some((p) => p.moduleId === module.id),

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

        screens: screens
          .filter((s) => s.pModuleId === module.id)
          .map(buildScreen),
      })),
    };

    return result;
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

      if (module.hasAccess && !hasSubModules && !hasDirectScreens) {
        permissions.push(
          this.rolePermissionRepository.create({ roleId, moduleId: module.moduleId }),
        );
      }

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
            if (action.hasAccess) {
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

            for (const child of action.children ?? []) {
              if (!child.hasAccess) continue;
              permissions.push(
                this.rolePermissionRepository.create({
                  roleId,
                  moduleId: module.moduleId,
                  subModuleId: subModule.subModuleId,
                  screenId: screen.screenId,
                  actionId: child.actionId,
                }),
              );
            }
          }
        }
      }

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
          if (action.hasAccess) {
            permissions.push(
              this.rolePermissionRepository.create({
                roleId,
                moduleId: module.moduleId,
                screenId: screen.screenId,
                actionId: action.actionId,
              }),
            );
          }

          for (const child of action.children ?? []) {
            if (!child.hasAccess) continue;
            permissions.push(
              this.rolePermissionRepository.create({
                roleId,
                moduleId: module.moduleId,
                screenId: screen.screenId,
                actionId: child.actionId,
              }),
            );
          }
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
}