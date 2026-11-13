import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectDataSource } from '@nestjs/typeorm'
import * as bcrypt from 'bcryptjs'
import { DataSource, DeepPartial, EntityManager, EntityTarget, FindOptionsWhere, ObjectLiteral } from 'typeorm'

import { Action } from '../modules/actions/entities/action.entity'
import { AttributeService } from '../modules/attribute/attribute.service'
import { Community } from '../modules/community/entities/community.entity'
import { LovService } from '../modules/lov/lov.service'
import { PModule } from '../modules/pmodules/entities/pmodule.entity'
import { PModulesService } from '../modules/pmodules/pmodules.service'
import { Property } from '../modules/property/entities/property.entity'
import { Role } from '../modules/role/entities/role.entity'
import { Screen } from '../modules/screens/entities/screen.entity'
import { ScreensService } from '../modules/screens/screens.service'
import { ActionsService } from '../modules/actions/actions.service'
import { RolePermissionsService } from '../modules/role-permissions/role-permissions.service'
import { SubModule } from '../modules/sub-modules/entities/sub-module.entity'
import { SubModulesService } from '../modules/sub-modules/sub-modules.service'
import { RegistrationDocumentRuleService } from '../modules/registration-document-rule/registration-document-rule.service'
import { Unit } from '../modules/unit/entities/unit.entity'
import { User } from '../modules/user/entities/user.entity'
import { UserRoleService } from '../modules/user-role/user-role.service'
import { IamService } from '../modules/iam/iam.service'
import { SYSTEM_ACTOR } from '../common/security/actor'
import { passwordPolicyViolations } from '../common/validators/strong-password.validator'
import { BUSINESS_CODE_PREFIXES, generateBusinessCode } from '../common/utils/business-code.util'
import {
  ACTIONS,
  PMODULES,
  ROLES,
  SCREENS,
  SUB_MODULES,
} from './seed-data'
import { SEED_COMMUNITIES, SEED_PROPERTIES, SEED_UNITS } from './seed-locations'
import { ROLES as ROLE_NAMES } from '../common/constants/global'
import { readBoolean, resolveAppEnvironment } from '../config/runtime-config'
import { APP_ENVIRONMENT, ENV_KEY } from '../common/constants/env.constants'
import { PASSWORD_HASH_ROUNDS } from '../common/constants/auth.constants'
import { MYSQL_ERROR_CODE } from '../common/constants/database.constants'

/** The address the shipped example configuration (.env.example) uses for the first administrator. Fine on a developer machine; a
 *  production installation must name the real person's address, so it is refused there. */
const DEMO_ADMIN_EMAIL = 'admin@ccb.local'

/** Outcome of one find-or-create: the row now in the database, and whether this call inserted it. */
interface SeedResult<T> {
  entity: T
  created: boolean
}

/**
 * Database initialization at application startup — the first-time installation flow of a customer's own CCB installation. The schema
 * itself is never created here — TypeORM has already run the migrations (the baseline migration builds every table on an empty
 * database) before this hook fires. What this decides is which kind of start this is, by whether the database has ever held a user
 * (soft-deleted and deactivated accounts count: an initialized installation is never re-seeded):
 *
 *  - FRESH database (no user row at all): load the initial data inside ONE transaction — modules, sub-modules, screens, actions,
 *    LOVs, attributes, the SUPER_ADMIN role, the installation's ONE default administrator, then — only when demo data is switched
 *    on (seedsDemoData) — the sample Community / Property / Unit data; afterwards the registration document rules and the IAM
 *    synchronization (resource catalogue + SUPER_ADMIN grants).
 *    The administrator account gets a temporary password from the installer's environment and MUST replace it at its first
 *    sign-in (users.must_change_password, enforced by the API). Every step is find-or-create on the row's natural key, so a
 *    database that already holds part of this data is completed, never duplicated or overwritten, and a failure rolls the whole
 *    transaction back.
 *  - EXISTING database (at least one user row): the initial seed is NEVER run again, so a repeated start can never create a second
 *    default administrator. Only the idempotent backfills run — they add what a newer release introduced and never touch what is
 *    already there. No existing role, account or policy is ever renamed or rewritten.
 */
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
    private readonly registrationDocumentRuleService: RegistrationDocumentRuleService,
    private readonly userRoleService: UserRoleService,
    private readonly iamService: IamService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if ((await this.countUsers()) > 0) {
      await this.startExistingDatabase()
      return
    }
    await this.initializeFreshDatabase()
  }

  /** Every user row counts — soft-deleted ones included. A database that has ever held a user is an initialized installation: it is
   *  never treated as fresh again, so a restart can never re-create a default administrator on it (with an e-mail the installer may
   *  have changed in the meantime, which would be a second super administrator). An installation that somehow has no usable
   *  administrator is recovered with the documented tool (docs/ON_PREMISE_SUPER_ADMIN.md), never by re-seeding. */
  private async countUsers(): Promise<number> {
    try {
      return await this.dataSource.getRepository(User).count({ withDeleted: true })
    } catch (err) {
      if (!this.isMissingTable(err)) throw err
      this.logger.error(`Schema check failed: ${(err as Error).message}`)
      throw new Error(
        'The database has no schema (the "users" table does not exist), so the migrations did not run. They run ' +
          'automatically at startup unless DB_MIGRATIONS_RUN=false — in that case run `npm run migration:run` ' +
          '(DB_MIGRATION_USERNAME / DB_MIGRATION_PASSWORD select a DDL-capable account) and start the API again.',
      )
    }
  }

  private isMissingTable(err: unknown): boolean {
    const failure = err as { code?: string; driverError?: { code?: string } }
    return (failure?.driverError?.code ?? failure?.code) === MYSQL_ERROR_CODE.NO_SUCH_TABLE
  }

  /** Existing database: pending migrations have already been applied by TypeORM. No initial seed — only backfills. */
  private async startExistingDatabase(): Promise<void> {
    this.logger.log('Existing database detected — initial seed skipped; applying idempotent backfills only')
    this.warnIfBootstrapPasswordLingers()
    try {
      await this.attributeService.ensureCriticalDefaults()
      await this.lovService.ensureCriticalDefaults()
      await this.pModulesService.ensureCriticalDefaults()
      await this.subModulesService.ensureCriticalDefaults()
      await this.screensService.ensureCriticalDefaults()
      await this.actionsService.ensureCriticalDefaults()
      await this.iamService.ensureResourceCatalog()
      await this.rolePermissionsService.ensureAdminGrants()
      await this.iamService.ensureAdminPolicyGrants()
      await this.registrationDocumentRuleService.ensureCriticalDefaults()
    } catch (err) {
      this.logger.error('Backfill of critical defaults failed — server will still start', err as Error)
    }
  }

  /** The temporary administrator password lives in the installer's environment only until the account has been created and its
   *  holder has replaced it. Once the database is initialized it has no job left, so a production environment is told to drop it. */
  private warnIfBootstrapPasswordLingers(): void {
    if (resolveAppEnvironment(process.env.NODE_ENV) !== APP_ENVIRONMENT.PRODUCTION) return
    if (this.config.get<string>(ENV_KEY.DEFAULT_ADMIN_PASSWORD)) {
      this.logger.warn(
        'SECURITY: DEFAULT_ADMIN_PASSWORD is still set in this environment although the installation is already initialized. ' +
          'Remove it (and restart) — it only exists to create the first account.',
      )
    }
  }

  /** Fresh database: schema is in place (migrations), no users yet. Seed, then synchronize IAM. */
  private async initializeFreshDatabase(): Promise<void> {
    this.logger.log('Fresh database detected — running initial seed...')

    try {
      await this.dataSource.transaction((manager) => this.seed(manager))

      // Committed from here on: the next start sees a user and takes the existing-database path, which repeats every
      // step below — so a failure here is retried automatically, it can never leave a half-initialized database behind.
      await this.registrationDocumentRuleService.ensureCriticalDefaults()
      await this.iamService.ensureResourceCatalog()
      await this.rolePermissionsService.ensureAdminGrants()
      await this.iamService.ensureAdminPolicyGrants()

      if (this.seedsDefaultAdmin()) {
        const adminEmail = this.config.get<string>(
          ENV_KEY.DEFAULT_ADMIN_EMAIL,
          DEMO_ADMIN_EMAIL,
        )
        this.logger.log(`Bootstrap complete — the installation's SUPER_ADMIN account was created: ${adminEmail}`)
        this.logger.warn(
          'SECURITY: the account must set its own password at its first sign-in. Remove DEFAULT_ADMIN_PASSWORD from this environment once that is done.',
        )
      } else {
        this.logger.log(
          'Bootstrap complete — no administrator account was created (BOOTSTRAP_SEED_ADMIN=false). ' +
            'Create the first SUPER_ADMIN with "npm run maintenance:super-admin" — see docs/ON_PREMISE_SUPER_ADMIN.md.',
        )
      }
    } catch (err) {
      this.logger.error('Bootstrap failed — application cannot start with an empty database', err)
      throw err
    }
  }


  private async seed(manager: EntityManager): Promise<void> {
    const pModuleMap = await this.seedPModules(manager)
    const subModuleMap = await this.seedSubModules(manager, pModuleMap)
    const screenMap = await this.seedScreens(manager, subModuleMap, pModuleMap)
    await this.seedActions(manager, screenMap)
    const lovMap = await this.lovService.seedValues(manager)
    await this.attributeService.seedValues(manager)
    const roleMap = await this.seedRoles(manager, lovMap)
    await this.seedSuperAdmin(manager, roleMap)
    if (this.seedsDemoData()) {
      await this.seedLocations(manager)
    } else {
      this.logger.log('Sample Community / Property / Unit data is not loaded (BOOTSTRAP_SEED_DEMO_DATA is off) — this installation starts with no business data.')
    }
  }

  /**
   * Whether the sample Community / Property / Unit data (seed-locations.ts — one estate's master data) is loaded on a fresh database. It is
   * DEMO data: a customer's installation must never start life holding another estate's communities, so
   *  - BOOTSTRAP_SEED_DEMO_DATA=true loads it — the explicit opt-in (a demo or training installation);
   *  - BOOTSTRAP_SEED_DEMO_DATA=false never loads it;
   *  - unset: loaded on a developer machine and in tests (development / test — what they have always got) and NEVER in production.
   * Only the sample business data is optional: the catalogue, lists of values, attributes, the role and the first administrator are not.
   */
  private seedsDemoData(): boolean {
    const production = resolveAppEnvironment(process.env.NODE_ENV) === APP_ENVIRONMENT.PRODUCTION
    return readBoolean(this.config.get<string>(ENV_KEY.BOOTSTRAP_SEED_DEMO_DATA), !production)
  }


  /**
   * Returns the row with these natural-key values if there is one — soft-deleted rows included, because the unique keys
   * span them and a row an admin removed must not be re-created — otherwise inserts `values`. Never updates an existing
   * row, which is what makes every seed safe to run against data that is already there.
   */
  private async findOrCreate<T extends ObjectLiteral>(
    manager: EntityManager,
    target: EntityTarget<T>,
    where: NoInfer<FindOptionsWhere<T>>,
    values: NoInfer<DeepPartial<T>>,
  ): Promise<SeedResult<T>> {
    const existing = await manager.findOne(target, { where, withDeleted: true })
    if (existing) return { entity: existing, created: false }

    const entity = await manager.save(manager.create(target, values))
    return { entity, created: true }
  }


  private async seedPModules(
    manager: EntityManager,
  ): Promise<Map<string, PModule>> {
    const map = new Map<string, PModule>()
    let created = 0

    for (const m of PMODULES) {
      const result = await this.findOrCreate(manager, PModule, { code: m.code }, {
        moduleName: m.moduleName,
        code: m.code,
        type: m.type,
        icon: m.icon,
        url: m.url,
        displayOrder: m.displayOrder,
        isActive: true,
      })
      map.set(m.code, result.entity)
      if (result.created) created++
    }

    this.logger.debug(`Modules: ${created} created, ${map.size - created} already present`)
    return map
  }


  private async seedSubModules(
    manager: EntityManager,
    pModuleMap: Map<string, PModule>,
  ): Promise<Map<string, SubModule>> {
    const map = new Map<string, SubModule>()
    let created = 0

    for (const sm of SUB_MODULES) {
      const pModule = pModuleMap.get(sm.pModuleCode)
      if (!pModule) {
        this.logger.warn(`SubModule "${sm.code}" skipped — PModule "${sm.pModuleCode}" not found`)
        continue
      }

      const result = await this.findOrCreate(manager, SubModule, { code: sm.code }, {
        pModuleId: pModule.id,
        name: sm.name,
        code: sm.code,
        icon: sm.icon,
        url: sm.url,
        displayOrder: sm.displayOrder,
        isActive: true,
      })
      map.set(sm.code, result.entity)
      if (result.created) created++
    }

    this.logger.debug(`Sub-modules: ${created} created, ${map.size - created} already present`)
    return map
  }


  private async seedScreens(
    manager: EntityManager,
    subModuleMap: Map<string, SubModule>,
    pModuleMap: Map<string, PModule>,
  ): Promise<Map<string, Screen>> {
    const map = new Map<string, Screen>()
    let created = 0

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

      const result = await this.findOrCreate(manager, Screen, { code: sc.code }, {
        subModuleId: subModuleId ?? null,
        pModuleId: pModuleId ?? null,
        name: sc.name,
        code: sc.code,
        url: sc.url ?? null,
        displayOrder: sc.displayOrder,
        isActive: true,
      })
      map.set(sc.code, result.entity)
      if (result.created) created++
    }

    this.logger.debug(`Screens: ${created} created, ${map.size - created} already present`)
    return map
  }


  private async seedActions(
    manager: EntityManager,
    screenMap: Map<string, Screen>,
  ): Promise<void> {
    let count = 0
    const actionMap = new Map<string, Action>()

    for (const ac of ACTIONS.filter((a) => !a.parentActionCode)) {
      const screen = screenMap.get(ac.screenCode)
      if (!screen) {
        this.logger.warn(`Action "${ac.code}" skipped — Screen "${ac.screenCode}" not found`)
        continue
      }

      const result = await this.findOrCreate(manager, Action, { code: ac.code }, {
        screenId: screen.id,
        name: ac.name,
        code: ac.code,
        description: ac.description,
        isActive: true,
        displayOrder: ac.displayOrder ?? 0,
      })
      actionMap.set(ac.code, result.entity)
      if (result.created) count++
    }

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

      const result = await this.findOrCreate(manager, Action, { code: ac.code }, {
        screenId: screen.id,
        name: ac.name,
        code: ac.code,
        description: ac.description,
        isActive: true,
        parentActionId: parent.id,
        displayOrder: ac.displayOrder ?? 0,
      })
      actionMap.set(ac.code, result.entity)
      if (result.created) count++
    }

    this.logger.debug(`Actions: ${count} created, ${actionMap.size - count} already present`)
  }


  private async seedRoles(
    manager: EntityManager,
    lovMap: Map<string, number>,
  ): Promise<Map<string, Role>> {
    const map = new Map<string, Role>()
    let created = 0

    for (const r of ROLES) {
      const userCategoryId = lovMap.get(`USER_CATEGORY:${r.userCategoryName.toLowerCase()}`)

      if (!userCategoryId) {
        this.logger.warn(
          `Role "${r.roleName}" skipped — missing LOV entry for "${r.userCategoryName}"`,
        )
        continue
      }

      const result = await this.findOrCreate(manager, Role, { roleName: r.roleName }, {
        roleName: r.roleName,
        roleDescription: r.roleDescription,
        userCategoryId,
        canBeReportingManager: r.canBeReportingManager,
      })
      map.set(r.roleName, result.entity)
      if (result.created) created++
    }

    this.logger.debug(`Roles: ${created} created, ${map.size - created} already present`)
    return map
  }


  /**
   * Whether a fresh database's first start creates the default administrator account (the default). BOOTSTRAP_SEED_ADMIN=false turns
   * it off: the installation then starts with the SUPER_ADMIN role and no user, so no password sits in any environment file, and the
   * first administrator is created afterwards with the maintenance tool (docs/ON_PREMISE_SUPER_ADMIN.md), which hands out a one-time
   * password that must be replaced at the first sign-in. Only the literal "false" changes anything. While no user row exists the
   * database still counts as fresh, so each start repeats the seed — every step of it is find-or-create.
   */
  private seedsDefaultAdmin(): boolean {
    return this.config.get<string>(ENV_KEY.BOOTSTRAP_SEED_ADMIN, 'true').trim().toLowerCase() !== 'false'
  }

  private async seedSuperAdmin(
    manager: EntityManager,
    roleMap: Map<string, Role>,
  ): Promise<void> {
    // The installation's ONE default administrator holds the SUPER_ADMIN role — the customer's own highest administrator, never a
    // CCB (vendor) account.
    const administratorRoleName = ROLE_NAMES.SUPER_ADMIN
    const superAdminRole = roleMap.get(administratorRoleName)
    if (!superAdminRole) {
      throw new Error(`Bootstrap error: ${administratorRoleName} role was not created — cannot seed admin user`)
    }

    if (!this.seedsDefaultAdmin()) {
      // The SUPER_ADMIN ROLE exists (checked above) and every grant is synchronised later; only the ACCOUNT is left out, so no password
      // for anyone sits in an env file. The first administrator is created afterwards with the maintenance tool.
      this.logger.log('BOOTSTRAP_SEED_ADMIN=false — the default administrator account is not created')
      return
    }

    const email = this.resolveDefaultAdminEmail()

    // The email is unique across ALL rows, deleted ones included, so look at every row before creating anything.
    const existingAdmin = await manager.findOne(User, { where: { email }, withDeleted: true })
    if (existingAdmin?.deletedAt) {
      throw new Error(
        `Bootstrap error: a deleted user with email "${email}" already exists, so the admin account cannot be created. ` +
          'Set DEFAULT_ADMIN_EMAIL to another address, or purge that row, and restart the application.',
      )
    }

    let adminId: number
    if (existingAdmin) {
      // Already there (another instance, or a half-run seed) — never rewrite its password or flags, only make sure the
      // role below is held.
      adminId = existingAdmin.id
      this.logger.debug(`Super Admin user already present: ${email}`)
    } else {
      const rawPassword = this.config.get<string>(ENV_KEY.DEFAULT_ADMIN_PASSWORD)
      if (!rawPassword) {
        throw new Error(
          'DEFAULT_ADMIN_PASSWORD environment variable is required for initial database setup. ' +
            'Add it to your .env file and restart the application.',
        )
      }

      // The one account that can create every other account must not start life with a weak password.
      const weaknesses = passwordPolicyViolations(rawPassword)
      if (weaknesses.length > 0) {
        throw new Error(
          `DEFAULT_ADMIN_PASSWORD does not meet the password policy (${weaknesses.join(', ')}). ` +
            'Set a stronger value in your env file and restart the application.',
        )
      }

      const rawName = this.config.get<string>('DEFAULT_ADMIN_NAME', 'System Administrator').trim()
      const spaceIndex = rawName.indexOf(' ')
      const firstName = spaceIndex === -1 ? rawName : rawName.slice(0, spaceIndex)
      const lastName = spaceIndex === -1 ? 'Administrator' : rawName.slice(spaceIndex + 1)

      const passwordHash = await bcrypt.hash(rawPassword, PASSWORD_HASH_ROUNDS)

      const admin = manager.create(User, {
        firstName,
        lastName,
        email,
        active: true,
        passwordHash,
        // The seed password sits in an env file (and is known to whoever installed the system), so the account's first sign-in must
        // replace it: the API refuses everything else until the holder has set their own password.
        mustChangePassword: true,
        passwordUpdatedAt: new Date(),
      })
      adminId = (await manager.save(admin)).id
      this.logger.debug(`Super Admin user created: ${email}`)
    }

    // user_roles is the only place a user's roles are recorded (users.role_id no longer exists) —
    // written in the same transaction as the rest of seed() so a fresh install never ends up with a
    // Super Admin that has no role. addRolesToUser is an additive ensure-held: idempotent, and it can
    // never remove a role someone else has granted to this account, so it stays safe if the seed
    // path is ever re-entered. (seed() only runs on a database with no users at all — see
    // onApplicationBootstrap.)
    await this.userRoleService.addRolesToUser(adminId, [superAdminRole.id], manager, SYSTEM_ACTOR)
  }

  /**
   * The address the default administrator account is created with: DEFAULT_ADMIN_EMAIL, or the shipped example address on a developer
   * machine. A production installation is the customer's own: its administrator is a real person, so there the address must be named
   * explicitly and the built-in example address is refused (a predictable default account name is exactly what a demo account is).
   */
  private resolveDefaultAdminEmail(): string {
    const configured = (this.config.get<string>(ENV_KEY.DEFAULT_ADMIN_EMAIL) ?? '').trim()
    const production = resolveAppEnvironment(process.env.NODE_ENV) === APP_ENVIRONMENT.PRODUCTION
    if (production && (configured === '' || configured.toLowerCase() === DEMO_ADMIN_EMAIL)) {
      throw new Error(
        `${ENV_KEY.DEFAULT_ADMIN_EMAIL} must be set to the real e-mail address of the person who will administer this installation — ` +
          'the built-in example address is not accepted outside a developer machine. Set it in the environment and restart the application.',
      )
    }
    return configured === '' ? DEMO_ADMIN_EMAIL : configured
  }


  /**
   * Community → Property → Unit master data (seed-locations.ts, taken from seed-community-property-unit.sql — no
   * invented or random rows). Find-or-create on the natural keys: community `code`, property `code`, and
   * (property, unit number) for units, which have no unique key of their own. Whatever already exists is left exactly
   * as it is, including a customised row and a soft-deleted one; only the missing rows are inserted. New rows get their
   * business code (COM-/PRP-/UNT-nnnnnn) from the generated id, the same rule every other service applies.
   */
  private async seedLocations(manager: EntityManager): Promise<void> {
    const communityMap = new Map<string, Community>()
    let communitiesCreated = 0
    for (const c of SEED_COMMUNITIES) {
      const result = await this.findOrCreate(manager, Community, { code: c.code }, {
        code: c.code,
        name: c.name,
        status: c.status,
        description: c.description,
        location: c.location,
        address: c.address,
        city: c.city,
        state: c.state,
        zipCode: c.zipCode,
        country: c.country,
        contactPerson: c.contactPerson,
        contactEmail: c.contactEmail,
        contactPhone: c.contactPhone,
      })
      if (result.created) {
        result.entity.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.COMMUNITY, result.entity.id)
        await manager.save(result.entity)
        communitiesCreated++
      }
      communityMap.set(c.code, result.entity)
    }

    const propertyMap = new Map<string, Property>()
    let propertiesCreated = 0
    for (const p of SEED_PROPERTIES) {
      const community = communityMap.get(p.communityCode)
      if (!community) {
        this.logger.warn(`Property "${p.code}" skipped — Community "${p.communityCode}" not found`)
        continue
      }

      const result = await this.findOrCreate(manager, Property, { code: p.code }, {
        community,
        code: p.code,
        name: p.name,
        propertyType: p.propertyType,
        numberOfFloors: p.numberOfFloors,
        status: p.status,
      })
      if (result.created) {
        result.entity.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.PROPERTY, result.entity.id)
        await manager.save(result.entity)
        propertiesCreated++
      }
      propertyMap.set(p.code, result.entity)
    }

    let unitsCreated = 0
    let unitsPresent = 0
    for (const u of SEED_UNITS) {
      const property = propertyMap.get(u.propertyCode)
      if (!property) {
        this.logger.warn(`Unit "${u.unitNumber}" skipped — Property "${u.propertyCode}" not found`)
        continue
      }

      const result = await this.findOrCreate(manager, Unit, { property: { id: property.id }, unitNumber: u.unitNumber }, {
        property,
        unitNumber: u.unitNumber,
        floorNumber: u.floorNumber,
        unitType: u.unitType,
        unitSize: u.unitSize,
        occupancyStatus: u.occupancyStatus,
        status: u.status,
        bedrooms: u.bedrooms,
        bathrooms: u.bathrooms,
        balcony: u.balcony,
        parkingSpaces: u.parkingSpaces,
        monthlyRent: u.monthlyRent,
        handoverDate: u.handoverDate,
        ownerId: u.ownerId,
        tenantId: u.tenantId,
        amenities: u.amenities,
        description: u.description,
      })
      if (result.created) {
        result.entity.businessCode = generateBusinessCode(BUSINESS_CODE_PREFIXES.UNIT, result.entity.id)
        await manager.save(result.entity)
        unitsCreated++
      } else {
        unitsPresent++
      }
    }

    this.logger.debug(
      `Communities: ${communitiesCreated} created, ${communityMap.size - communitiesCreated} already present; ` +
        `properties: ${propertiesCreated} created, ${propertyMap.size - propertiesCreated} already present; ` +
        `units: ${unitsCreated} created, ${unitsPresent} already present`,
    )
  }
}
