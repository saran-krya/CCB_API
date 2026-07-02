import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectDataSource } from '@nestjs/typeorm'
import * as bcrypt from 'bcryptjs'
import { DataSource, EntityManager } from 'typeorm'

import { Action } from '../modules/actions/entities/action.entity'
import { PModule } from '../modules/pmodules/entities/pmodule.entity'
import { Role } from '../modules/role/entities/role.entity'
import { Screen } from '../modules/screens/entities/screen.entity'
import { SubModule } from '../modules/sub-modules/entities/sub-module.entity'
import { UserCategory } from '../modules/user-category/entities/user-category.entity'
import { UserType } from '../modules/user-type/entities/user-type.entity'
import { User } from '../modules/user/entities/user.entity'
import {
  ACTIONS,
  PMODULES,
  ROLES,
  SCREENS,
  SUB_MODULES,
  USER_CATEGORIES,
  USER_TYPES,
} from './seed-data'

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name)

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const userCount = await this.dataSource.getRepository(User).count()

    if (userCount > 0) {
      this.logger.log('Bootstrap skipped — database already initialized')
      return
    }

    this.logger.log('Fresh database detected — running bootstrap seed...')

    try {
      await this.dataSource.transaction((manager) => this.seed(manager))

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
    const categoryMap = await this.seedUserCategories(manager)
    const typeMap = await this.seedUserTypes(manager)
    const pModuleMap = await this.seedPModules(manager)
    const subModuleMap = await this.seedSubModules(manager, pModuleMap)
    const screenMap = await this.seedScreens(manager, subModuleMap, pModuleMap)
    await this.seedActions(manager, screenMap)
    const roleMap = await this.seedRoles(manager, categoryMap, typeMap)
    await this.seedSuperAdmin(manager, roleMap)
  }

  // ---------------------------------------------------------------------------
  // Step 1 — User categories
  // ---------------------------------------------------------------------------

  private async seedUserCategories(
    manager: EntityManager,
  ): Promise<Map<string, UserCategory>> {
    const map = new Map<string, UserCategory>()

    for (const cat of USER_CATEGORIES) {
      const entity = manager.create(UserCategory, {
        name: cat.name,
        description: cat.description,
        active: true,
      })
      const saved = await manager.save(entity)
      map.set(cat.name, saved)
    }

    this.logger.debug(`Seeded ${map.size} user categories`)
    return map
  }

  // ---------------------------------------------------------------------------
  // Step 2 — User types
  // ---------------------------------------------------------------------------

  private async seedUserTypes(
    manager: EntityManager,
  ): Promise<Map<string, UserType>> {
    const map = new Map<string, UserType>()

    for (const ut of USER_TYPES) {
      const entity = manager.create(UserType, {
        name: ut.name,
        description: ut.description,
        isActive: true,
      })
      const saved = await manager.save(entity)
      map.set(ut.name, saved)
    }

    this.logger.debug(`Seeded ${map.size} user types`)
    return map
  }

  // ---------------------------------------------------------------------------
  // Step 3 — PModules (top-level navigation modules)
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
  // Step 4 — SubModules
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
  // Step 5 — Screens
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
  // Step 6 — Actions
  // ---------------------------------------------------------------------------

  private async seedActions(
    manager: EntityManager,
    screenMap: Map<string, Screen>,
  ): Promise<void> {
    let count = 0

    for (const ac of ACTIONS) {
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
      })
      await manager.save(entity)
      count++
    }

    this.logger.debug(`Seeded ${count} actions`)
  }

  // ---------------------------------------------------------------------------
  // Step 7 — Roles
  // ---------------------------------------------------------------------------

  private async seedRoles(
    manager: EntityManager,
    categoryMap: Map<string, UserCategory>,
    typeMap: Map<string, UserType>,
  ): Promise<Map<string, Role>> {
    const map = new Map<string, Role>()

    for (const r of ROLES) {
      const category = categoryMap.get(r.userCategoryName)
      const userType = typeMap.get(r.userTypeName)

      if (!category || !userType) {
        this.logger.warn(
          `Role "${r.roleName}" skipped — missing category "${r.userCategoryName}" or type "${r.userTypeName}"`,
        )
        continue
      }

      const entity = manager.create(Role, {
        roleName: r.roleName,
        roleDescription: r.roleDescription,
        userCategoryId: category.id,
        userTypeId: userType.id,
        canBeReportingManager: r.canBeReportingManager,
      })
      const saved = await manager.save(entity)
      map.set(r.roleName, saved)
    }

    this.logger.debug(`Seeded ${map.size} roles`)
    return map
  }

  // ---------------------------------------------------------------------------
  // Step 8 — Default Super Admin user
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
