import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
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
import { AuditService } from '../../audit/audit.service';
import { ROLES } from '@app/common/constants/global';
import { IamService } from '../iam/iam.service';

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

    private readonly dataSource: DataSource,

    private readonly audit: AuditService,

    private readonly iamService: IamService,

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
    actorId?: number,
  ) {
    return this.dataSource.transaction(async (manager) => {
    const roleRepo = manager.getRepository(Role);
    const rolePermissionRepo = manager.getRepository(RolePermission);

    const existingRole =
      await roleRepo.findOne({
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
      await roleRepo.save(
        roleRepo.create({
          roleName: dto.roleName,
          roleDescription:
            dto.roleDescription,
          userCategoryId:
            dto.userCategoryId,
          canBeReportingManager:
            dto.canBeReportingManager ??
            false,
          canBeFieldInspector:
            dto.canBeFieldInspector ??
            false,
        }),
      );

    await rolePermissionRepo.delete({
      roleId: role.id,
    });

    const permissions: RolePermission[] =
      [];

    for (const module of dto.screenPermissionList ?? []) {
      const hasSubModules = module.subModule && module.subModule.length > 0;
      const hasDirectScreens = module.screens && module.screens.length > 0;

      if (module.hasAccess && !hasSubModules && !hasDirectScreens) {
        permissions.push(
          rolePermissionRepo.create({ roleId: role.id, moduleId: module.moduleId }),
        );
      }

      for (const subModule of module.subModule ?? []) {
        if (subModule.hasAccess && (!subModule.screens || subModule.screens.length === 0)) {
          permissions.push(
            rolePermissionRepo.create({
              roleId: role.id,
              moduleId: module.moduleId,
              subModuleId: subModule.subModuleId,
            }),
          );
        }

        for (const screen of subModule.screens ?? []) {
          if (screen.hasAccess && (!screen.actions || screen.actions.length === 0)) {
            permissions.push(
              rolePermissionRepo.create({
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
                rolePermissionRepo.create({
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
                rolePermissionRepo.create({
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
            rolePermissionRepo.create({
              roleId: role.id,
              moduleId: module.moduleId,
              screenId: screen.screenId,
            }),
          );
        }

        for (const action of screen.actions ?? []) {
          if (action.hasAccess) {
            permissions.push(
              rolePermissionRepo.create({
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
              rolePermissionRepo.create({
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
      await rolePermissionRepo.save(
        permissions,
      );
    }

    // Audited inside the SAME transaction as the role + permission rows above — a thrown error
    // anywhere before this point rolls back the whole transaction, so this call only ever runs
    // after the role/permissions are actually committed-pending (never a misleading success log for
    // a save that didn't happen). oldValue is omitted: this is a brand-new role, so there is no
    // prior permission state to record.
    await this.audit.record(
      {
        moduleName: 'role_permissions',
        entityId: role.id,
        action: 'CREATE',
        newValue: { roleId: role.id, roleName: role.roleName, grantedCount: permissions.length },
        performedBy: actorId,
      },
      manager,
    );

    return {
      message:
        'Role and permissions saved successfully',
      roleId: role.id,
      count:
        permissions.length,
    };
    });
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

  /**
   * IAM migration (Role -> Policy -> Resource -> Action) — FULL CUTOVER (post AddIamPolicyBackfill).
   * This is now the ONLY authorization source: every role's access is resolved exclusively through
   * its attached Policies' Allow statements. Legacy `role_permissions` rows are never consulted here
   * again, for ANY role, including a role with zero attached Policies — zero Policies resolves to
   * zero granted actions (deny-by-default), never a fallback read of the old table. This is
   * deliberate: an OR/fallback to legacy grants would let a stale RolePermission row silently
   * override a Policy revocation, which is exactly the "one clear source of truth" requirement this
   * migration exists to satisfy. `role_permissions` rows are kept in the table as historical/rollback
   * data only (see AddIamPolicyBackfill's down()) — they are inert for every live authorization check
   * (this method, rolesHaveAction and PermissionGuard) from this point on. The three roles that had
   * zero actionable legacy grants to begin with (Technical: no rows at all; user01/user02: a single
   * bare module-level row with a null actionId, which this method's old legacy branch could never
   * have matched anyway since it always joined on a non-null actionId) needed no backfill — zero
   * attached Policies is already their exact equivalent. Their module-level nav-visibility flag is
   * unaffected: getPermissionTree() reads role_permissions directly and is a wholly separate code
   * path from this method, untouched by this cutover.
   */
  async roleHasAction(roleId: number, actionCode: string): Promise<boolean> {
    return this.iamService.roleHasActionViaPolicy(roleId, actionCode);
  }

  /** True iff ANY of `roleIds` — or the user's own inline policies, when `userId` is given — grants
   *  `actionCode`: the check for a USER, who may hold several roles: PermissionGuard and every
   *  service-level permission check pass the user's LIVE role set (principal.roleIds, resolved per
   *  request by JwtStrategy), never a single role, plus the authenticated user's id. Same Policy-only
   *  resolution as roleHasAction; see IamService.getActionCodesGrantedByPoliciesForRoles for the
   *  exact additive-union semantics. roleHasAction stays for ROLE-keyed questions (e.g. "does this
   *  configured approver role hold the approve code"), never for authorizing a user's own request. */
  async rolesHaveAction(roleIds: number[], actionCode: string, userId?: number): Promise<boolean> {
    return this.iamService.rolesHaveActionViaPolicy(roleIds, actionCode, userId);
  }

  /** The full set of Action codes a role actually holds via its attached Policies — same resolution
   *  path as roleHasAction/PermissionGuard (IamService.getActionCodesGrantedByPolicies), just
   *  returning every granted code at once instead of checking one. */
  async getMyActionCodes(roleId: number): Promise<string[]> {
    const codes = await this.iamService.getActionCodesGrantedByPolicies(roleId);
    return [...codes];
  }

  /** The UNION of Action codes granted across all of `roleIds` (plus the user's own inline policies,
   *  when `userId` is given) — what `GET /auth/me/actions` returns for the principal's live role set,
   *  so the frontend can drive Policy-based sidebar visibility from the exact same source of truth
   *  the backend's own authorization guard uses (never the legacy role_permissions tree). Empty for
   *  an empty role set with no user. */
  async getMyActionCodesForRoles(roleIds: number[], userId?: number): Promise<string[]> {
    const codes = await this.iamService.getActionCodesGrantedByPoliciesForRoles(roleIds, userId);
    return [...codes];
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

  /** Grants ONE specific action to SUPER_ADMIN only (never ADMIN) — for an action deliberately kept
   *  out of ensureAdminGrants' blanket auto-grant loop (ADMIN_GRANT_EXCLUDED_ACTION_CODES) but that
   *  still needs at least one holder from day one, or nothing could ever use it (no auto-grant, and
   *  no reachable UI to self-grant an excluded action after the fact). Idempotent — a no-op once the
   *  grant already exists. Runs on every boot alongside ensureAdminGrants, not just fresh installs,
   *  the same convention as this codebase's other ensure-prefixed / ensureCriticalDefaults methods. */
  async ensureSuperAdminGrant(actionCode: string): Promise<void> {
    const superAdmin = await this.roleRepository.findOne({ where: { roleName: 'SUPER_ADMIN' } });
    if (!superAdmin) return;

    const action = await this.actionRepository.findOne({
      where: { code: actionCode },
      relations: { screen: { subModule: true, pModule: true } },
    });
    if (!action) return;

    const screen = action.screen;
    if (!screen) return;
    const moduleId = screen.subModule?.pModuleId ?? screen.pModuleId;
    if (!moduleId) return;

    const exists = await this.rolePermissionRepository.findOne({
      where: { roleId: superAdmin.id, actionId: action.id },
    });
    if (exists) return;

    const grant = this.rolePermissionRepository.create({
      roleId: superAdmin.id,
      moduleId,
      subModuleId: screen.subModuleId ?? null,
      screenId: screen.id,
      actionId: action.id,
    });
    await this.rolePermissionRepository.save(grant);
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

    // isActive: false is how a module/sub-module/screen/action is retired from the Roles &
    // Permissions UI without breaking any already-granted role or any backend @Permission(...)
    // check still referencing it by code — roleHasAction() and the guard both key off actionId/
    // code alone, never isActive, so an existing grant keeps working exactly as before; it simply
    // stops being independently manageable/visible in this tree going forward.
    const modules = await this.pModuleRepository.find({
      where: { isActive: true },
      order: { displayOrder: 'ASC' },
    });
    const subModules = await this.subModuleRepository.find({ where: { isActive: true } });
    const screens = await this.screenRepository.find({ where: { isActive: true } });
    const actions = await this.actionRepository.find({ where: { isActive: true } });

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
      canBeFieldInspector: role?.canBeFieldInspector ?? false,
      // The system-managed role can't be renamed (see updateRolePermissions) — the edit form locks the field from this.
      isSystem: role?.roleName === ROLES.SUPER_ADMIN,
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
    actorId?: number,
  ) {
    return this.dataSource.transaction(async (manager) => {
    const roleRepo = manager.getRepository(Role);
    const rolePermissionRepo = manager.getRepository(RolePermission);

    const role =
      await roleRepo.findOne({
        where: { id: roleId },
      });

    if (!role) {
      throw new NotFoundException(
        "Role not found",
      );
    }

    // RolesGuard's SUPER_ADMIN bypass and ensureAdminPolicyGrants/ensureAdminGrants's reconciliation
    // both key off this literal string (see common/guards/roles.guard.ts and iam.service.ts) — an
    // edit that renamed it away would silently strand the system with no role either mechanism
    // recognizes as root, on this role's very next grant-reconciliation pass or guard check.
    if (role.roleName === ROLES.SUPER_ADMIN && dto.roleName !== ROLES.SUPER_ADMIN) {
      throw new ConflictException(
        "SUPER_ADMIN's role name is relied on throughout the system and cannot be changed.",
      );
    }

    // Captured BEFORE the delete below, as the audit's oldValue — action codes only (not full
    // RolePermission rows with their internal ids), so the audit log reads as "which actions this
    // role could do before" rather than opaque foreign-key numbers.
    const previousActionCodes = await rolePermissionRepo
      .createQueryBuilder('rp')
      .innerJoin(Action, 'a', 'a.id = rp.actionId')
      .where('rp.roleId = :roleId', { roleId })
      .select('a.code', 'code')
      .getRawMany<{ code: string }>()
      .then((rows) => rows.map((r) => r.code));

    Object.assign(role, {
      roleName: dto.roleName,
      roleDescription:
        dto.roleDescription,
      userCategoryId:
        dto.userCategoryId,
      canBeReportingManager:
        dto.canBeReportingManager,
      canBeFieldInspector:
        dto.canBeFieldInspector,
    });

    await roleRepo.save(role);

    await rolePermissionRepo.delete({
      roleId,
    });

    const permissions: RolePermission[] =
      [];

    for (const module of dto.screenPermissionList ?? []) {
      const hasSubModules = module.subModule && module.subModule.length > 0;
      const hasDirectScreens = module.screens && module.screens.length > 0;

      if (module.hasAccess && !hasSubModules && !hasDirectScreens) {
        permissions.push(
          rolePermissionRepo.create({ roleId, moduleId: module.moduleId }),
        );
      }

      for (const subModule of module.subModule ?? []) {
        if (subModule.hasAccess && (!subModule.screens || subModule.screens.length === 0)) {
          permissions.push(
            rolePermissionRepo.create({
              roleId,
              moduleId: module.moduleId,
              subModuleId: subModule.subModuleId,
            }),
          );
        }

        for (const screen of subModule.screens ?? []) {
          if (screen.hasAccess && (!screen.actions || screen.actions.length === 0)) {
            permissions.push(
              rolePermissionRepo.create({
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
                rolePermissionRepo.create({
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
                rolePermissionRepo.create({
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
            rolePermissionRepo.create({
              roleId,
              moduleId: module.moduleId,
              screenId: screen.screenId,
            }),
          );
        }

        for (const action of screen.actions ?? []) {
          if (action.hasAccess) {
            permissions.push(
              rolePermissionRepo.create({
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
              rolePermissionRepo.create({
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
      await rolePermissionRepo.save(
        permissions,
      );
    }

    const newActionCodes = await rolePermissionRepo
      .createQueryBuilder('rp')
      .innerJoin(Action, 'a', 'a.id = rp.actionId')
      .where('rp.roleId = :roleId', { roleId })
      .select('a.code', 'code')
      .getRawMany<{ code: string }>()
      .then((rows) => rows.map((r) => r.code));

    // Same in-transaction audit guarantee as savePermissions above — only runs after the delete +
    // re-insert above have actually succeeded within this same transaction, so a thrown error
    // anywhere in this method rolls back both the permission change AND this audit row together.
    await this.audit.record(
      {
        moduleName: 'role_permissions',
        entityId: roleId,
        action: 'UPDATE',
        oldValue: { actionCodes: previousActionCodes },
        newValue: { actionCodes: newActionCodes },
        performedBy: actorId,
      },
      manager,
    );

    return {
      message:
        "Role updated successfully",
      roleId,
      count: permissions.length,
    };
    });
  }
}