import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectDataSource } from '@nestjs/typeorm'
import * as bcrypt from 'bcryptjs'
import { DataSource, EntityManager } from 'typeorm'

import { Action } from '../modules/actions/entities/action.entity'
import { AttributeService } from '../modules/attribute/attribute.service'
import { LovService } from '../modules/lov/lov.service'
import { PModule } from '../modules/pmodules/entities/pmodule.entity'
import { PModulesService } from '../modules/pmodules/pmodules.service'
import { Role } from '../modules/role/entities/role.entity'
import { Screen } from '../modules/screens/entities/screen.entity'
import { ScreensService } from '../modules/screens/screens.service'
import { ActionsService } from '../modules/actions/actions.service'
import { RolePermissionsService } from '../modules/role-permissions/role-permissions.service'
import { SubModule } from '../modules/sub-modules/entities/sub-module.entity'
import { SubModulesService } from '../modules/sub-modules/sub-modules.service'
import { User } from '../modules/user/entities/user.entity'
import {
  ACTIONS,
  ADMIN_GRANT_EXCLUDED_ACTION_CODES,
  PMODULES,
  ROLES,
  SCREENS,
  SUB_MODULES,
} from './seed-data'

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name)

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly lovService: LovService,
    private readonly attributeService: AttributeService,
    private readonly pModulesService: PModulesService,
    private readonly subModulesService: SubModulesService,
    private readonly screensService: ScreensService,
    private readonly actionsService: ActionsService,
    private readonly rolePermissionsService: RolePermissionsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const userCount = await this.dataSource.getRepository(User).count()

    if (userCount > 0) {
      this.logger.log('Bootstrap skipped — database already initialized')
      // Fresh databases get every General Attribute / LOV category / Module /
      // SubModule / Screen / Action from seedValues()/seed() below. Already-
      // initialized ones only get what existed at the time they were first
      // bootstrapped — this backfills anything added since, e.g. Session
      // Timeout, TARIFF_UNIT_TYPE, or (for the permission migration) new
      // Screen/Action rows like the LFM/Attributes/Tariff screens' actions,
      // plus the one-time PModule code correction (see
      // PModulesService.MODULE_NAME_CODE_FIXES). Modules must backfill
      // before SubModules before Screens before Actions before Admin
      // grants — each step's FK lookups depend on the previous one already
      // existing. A failure here must never crash startup of an already-
      // running system — each service's own ensureCriticalDefaults()/
      // ensureAdminGrants() already catches per-row errors internally, but
      // this outer guard covers anything unexpected escaping one of them
      // anyway.
      try {
        await this.attributeService.ensureCriticalDefaults()
        await this.lovService.ensureCriticalDefaults()
        await this.pModulesService.ensureCriticalDefaults()
        await this.subModulesService.ensureCriticalDefaults()
        await this.screensService.ensureCriticalDefaults()
        await this.actionsService.ensureCriticalDefaults()
        await this.rolePermissionsService.ensureAdminGrants(ADMIN_GRANT_EXCLUDED_ACTION_CODES)
      } catch (err) {
        this.logger.error('Backfill of critical defaults failed — server will still start', err as Error)
      }
      return
    }

    this.logger.log('Fresh database detected — running bootstrap seed...')

    try {
      await this.dataSource.transaction((manager) => this.seed(manager))

      // Runs after the seed transaction commits, not inside it —
      // ensureAdminGrants() reads through the service's own repositories
      // (a separate connection from the transaction's EntityManager), so it
      // would see nothing yet if run before commit.
      await this.rolePermissionsService.ensureAdminGrants(ADMIN_GRANT_EXCLUDED_ACTION_CODES)

      const adminEmail = this.config.get<string>(
        'DEFAULT_ADMIN_EMAIL',
        'admin@ccb.local',
      )
      this.logger.log(`Bootstrap complete — Super Admin account created: ${adminEmail}`)
      this.logger.warn(
        'SECURITY: Change the default admin password immediately after first login.',
      )
    } catch (err) {
      this.logger.error('Bootstrap failed — application cannot start with an empty database', err)
      throw err
    }
  }

  // ---------------------------------------------------------------------------
  // Seeding — runs inside a single transaction
  // ---------------------------------------------------------------------------

  private async seed(manager: EntityManager): Promise<void> {
    const pModuleMap = await this.seedPModules(manager)
    const subModuleMap = await this.seedSubModules(manager, pModuleMap)
    const screenMap = await this.seedScreens(manager, subModuleMap, pModuleMap)
    await this.seedActions(manager, screenMap)
    const lovMap = await this.lovService.seedValues(manager)
    await this.attributeService.seedValues(manager)
    const roleMap = await this.seedRoles(manager, lovMap)
    await this.seedSuperAdmin(manager, roleMap)
  }

  // ---------------------------------------------------------------------------
  // Step 1 — PModules (top-level navigation modules)
  // ---------------------------------------------------------------------------

  private async seedPModules(
    manager: EntityManager,
  ): Promise<Map<string, PModule>> {
    const map = new Map<string, PModule>()

    for (const m of PMODULES) {
      const entity = manager.create(PModule, {
        moduleName: m.moduleName,
        code: m.code,
        type: m.type,
        icon: m.icon,
        url: m.url,
        displayOrder: m.displayOrder,
        isActive: true,
      })
      const saved = await manager.save(entity)
      map.set(m.code, saved)
    }

    this.logger.debug(`Seeded ${map.size} modules`)
    return map
  }

  // ---------------------------------------------------------------------------
  // Step 2 — SubModules
  // ---------------------------------------------------------------------------

  private async seedSubModules(
    manager: EntityManager,
    pModuleMap: Map<string, PModule>,
  ): Promise<Map<string, SubModule>> {
    const map = new Map<string, SubModule>()

    for (const sm of SUB_MODULES) {
      const pModule = pModuleMap.get(sm.pModuleCode)
      if (!pModule) {
        this.logger.warn(`SubModule "${sm.code}" skipped — PModule "${sm.pModuleCode}" not found`)
        continue
      }

      const entity = manager.create(SubModule, {
        pModuleId: pModule.id,
        name: sm.name,
        code: sm.code,
        icon: sm.icon,
        url: sm.url,
        displayOrder: sm.displayOrder,
        isActive: true,
      })
      const saved = await manager.save(entity)
      map.set(sm.code, saved)
    }

    this.logger.debug(`Seeded ${map.size} sub-modules`)
    return map
  }

  // ---------------------------------------------------------------------------
  // Step 3 — Screens
  // ---------------------------------------------------------------------------

  private async seedScreens(
    manager: EntityManager,
    subModuleMap: Map<string, SubModule>,
    pModuleMap: Map<string, PModule>,
  ): Promise<Map<string, Screen>> {
    const map = new Map<string, Screen>()

    for (const sc of SCREENS) {
      if (!sc.subModuleCode && !sc.pModuleCode) {
        this.logger.warn(`Screen "${sc.code}" skipped — neither subModuleCode nor pModuleCode specified`)
        continue
      }

      let subModuleId: number | undefined
      let pModuleId: number | undefined

      if (sc.subModuleCode) {
        const subModule = subModuleMap.get(sc.subModuleCode)
        if (!subModule) {
          this.logger.warn(`Screen "${sc.code}" skipped — SubModule "${sc.subModuleCode}" not found`)
          continue
        }
        subModuleId = subModule.id
      } else if (sc.pModuleCode) {
        const pModule = pModuleMap.get(sc.pModuleCode)
        if (!pModule) {
          this.logger.warn(`Screen "${sc.code}" skipped — PModule "${sc.pModuleCode}" not found`)
          continue
        }
        pModuleId = pModule.id
      }

      const entity = manager.create(Screen, {
        subModuleId: subModuleId ?? null,
        pModuleId: pModuleId ?? null,
        name: sc.name,
        code: sc.code,
        url: sc.url ?? null,
        displayOrder: sc.displayOrder,
        isActive: true,
      })
      const saved = await manager.save(entity)
      map.set(sc.code, saved)
    }

    this.logger.debug(`Seeded ${map.size} screens`)
    return map
  }

  // ---------------------------------------------------------------------------
  // Step 4 — Actions
  // ---------------------------------------------------------------------------

  private async seedActions(
    manager: EntityManager,
    screenMap: Map<string, Screen>,
  ): Promise<void> {
    let count = 0
    const actionMap = new Map<string, Action>()

    // Pass 1 — top-level actions (no parentActionCode). Builds actionMap so
    // pass 2 can resolve each child's real parentActionId.
    for (const ac of ACTIONS.filter((a) => !a.parentActionCode)) {
      const screen = screenMap.get(ac.screenCode)
      if (!screen) {
        this.logger.warn(`Action "${ac.code}" skipped — Screen "${ac.screenCode}" not found`)
        continue
      }

      const entity = manager.create(Action, {
        screenId: screen.id,
        name: ac.name,
        code: ac.code,
        description: ac.description,
        isActive: true,
        displayOrder: ac.displayOrder ?? 0,
      })
      const saved = await manager.save(entity)
      actionMap.set(ac.code, saved)
      count++
    }

    // Pass 2 — child actions, resolved against actionMap from pass 1.
    for (const ac of ACTIONS.filter((a) => a.parentActionCode)) {
      const screen = screenMap.get(ac.screenCode)
      if (!screen) {
        this.logger.warn(`Action "${ac.code}" skipped — Screen "${ac.screenCode}" not found`)
        continue
      }

      const parent = actionMap.get(ac.parentActionCode!)
      if (!parent) {
        this.logger.warn(`Action "${ac.code}" skipped — parent action "${ac.parentActionCode}" not found`)
        continue
      }

      const entity = manager.create(Action, {
        screenId: screen.id,
        name: ac.name,
        code: ac.code,
        description: ac.description,
        isActive: true,
        parentActionId: parent.id,
        displayOrder: ac.displayOrder ?? 0,
      })
      const saved = await manager.save(entity)
      actionMap.set(ac.code, saved)
      count++
    }

    this.logger.debug(`Seeded ${count} actions`)
  }

  // ---------------------------------------------------------------------------
  // Step 5 — Roles
  // ---------------------------------------------------------------------------

  private async seedRoles(
    manager: EntityManager,
    lovMap: Map<string, number>,
  ): Promise<Map<string, Role>> {
    const map = new Map<string, Role>()

    for (const r of ROLES) {
      const userCategoryId = lovMap.get(`USER_CATEGORY:${r.userCategoryName.toLowerCase()}`)
      const userTypeId = lovMap.get(`USER_TYPE:${r.userTypeName.toLowerCase()}`)

      if (!userCategoryId || !userTypeId) {
        this.logger.warn(
          `Role "${r.roleName}" skipped — missing LOV entry for "${r.userCategoryName}" or "${r.userTypeName}"`,
        )
        continue
      }

      const entity = manager.create(Role, {
        roleName: r.roleName,
        roleDescription: r.roleDescription,
        userCategoryId,
        userTypeId,
        canBeReportingManager: r.canBeReportingManager,
      })
      const saved = await manager.save(entity)
      map.set(r.roleName, saved)
    }

    this.logger.debug(`Seeded ${map.size} roles`)
    return map
  }

  // ---------------------------------------------------------------------------
  // Step 6 — Default Super Admin user
  // ---------------------------------------------------------------------------

  private async seedSuperAdmin(
    manager: EntityManager,
    roleMap: Map<string, Role>,
  ): Promise<void> {
    const superAdminRole = roleMap.get('SUPER_ADMIN')
    if (!superAdminRole) {
      throw new Error('Bootstrap error: SUPER_ADMIN role was not created — cannot seed admin user')
    }

    const rawPassword = this.config.get<string>('DEFAULT_ADMIN_PASSWORD')
    if (!rawPassword) {
      throw new Error(
        'DEFAULT_ADMIN_PASSWORD environment variable is required for initial database setup. ' +
          'Add it to your .env file and restart the application.',
      )
    }

    const rawName = this.config.get<string>('DEFAULT_ADMIN_NAME', 'System Administrator').trim()
    const spaceIndex = rawName.indexOf(' ')
    const firstName = spaceIndex === -1 ? rawName : rawName.slice(0, spaceIndex)
    const lastName = spaceIndex === -1 ? 'Administrator' : rawName.slice(spaceIndex + 1)

    const email = this.config.get<string>('DEFAULT_ADMIN_EMAIL', 'admin@ccb.local')
    const passwordHash = await bcrypt.hash(rawPassword, 12)

    const admin = manager.create(User, {
      role: superAdminRole,
      firstName,
      lastName,
      email,
      active: true,
      passwordHash,
    })
    await manager.save(admin)

    this.logger.debug(`Super Admin user created: ${email}`)
  }
}
