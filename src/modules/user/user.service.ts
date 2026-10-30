import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../common/utils/pagination.util';
import { RoleService } from '../role/role.service';
import { Role } from '../role/entities/role.entity';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { User } from './entities/user.entity';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { AttributeService } from '../attribute/attribute.service';
import { LovService } from '../lov/lov.service';
import { UserRoleService } from '../user-role/user-role.service';

interface DynamicFieldRequirement {
  // keyof UpdateUserDto, not CreateUserDto: both create and update are checked, and `roleIds` (the
  // one create-only field) is never a dynamically-required one.
  field: keyof UpdateUserDto;
  attributeKey: string;
  label: string;
}

const DYNAMIC_FIELD_REQUIREMENTS: DynamicFieldRequirement[] = [
  { field: 'reportingManagerId', attributeKey: 'REPORTING_MANAGER_MANDATORY', label: 'Reporting Manager' },
];

/** A User plus its current role assignment, attached at query time (never persisted — see the note on
 *  the User entity). `roles` is every role the user holds in assignment order; `role` is the first of
 *  them (the PRIMARY), null when there is none, kept for compatibility with callers that predate
 *  multi-role. */
export type UserWithRoles = User & { role: Role | null; roles: Role[] };

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,

    private readonly rolePermissionService: RolePermissionsService,

    private readonly roles: RoleService,

    private readonly audit: AuditService,

    private readonly attributes: AttributeService,

    private readonly lov: LovService,

    private readonly userRoles: UserRoleService,
  ) { }

  private async assertDynamicRequiredFields(dto: CreateUserDto | UpdateUserDto): Promise<void> {
    for (const spec of DYNAMIC_FIELD_REQUIREMENTS) {
      if (!(spec.field in dto)) continue;
      const isMandatory = await this.attributes.isMandatory(spec.attributeKey);
      if (isMandatory && !dto[spec.field]) {
        throw new BadRequestException(`${spec.label} is mandatory`);
      }
    }
  }

  async create(
    dto: CreateUserDto,
    actorId?: number,
  ) {
    await this.validateUniqueFields(dto);
    await this.assertDynamicRequiredFields(dto);

    // Before anything is written, so one unknown role id can never leave a half-created user behind.
    await this.assertRolesExist(dto.roleIds);

    const reportingManager =
      dto.reportingManagerId
        ? await this.users.findOne({
          where: {
            id: dto.reportingManagerId,
          },
        })
        : null;

    const user = new User();

    user.reportingManager =
      reportingManager ??
      undefined;

    user.firstName =
      dto.firstName;

    user.middleName =
      dto.middleName;

    user.lastName =
      dto.lastName;

    user.designation =
      dto.designation;

    user.email =
      dto.email;

    user.mobile =
      dto.mobile;

    user.employeeCode =
      dto.employeeCode;

    user.active =
      dto.active ?? true;

    user.passwordHash =
      dto.password
        ? await bcrypt.hash(
          dto.password,
          12,
        )
        : null;

    user.passwordUpdatedAt =
      dto.password
        ? new Date()
        : null;

    user.mustChangePassword =
      dto.mustChangePassword ?? false;

    // One unit of work: the user, its roles (user_roles is the only place they are recorded — see
    // UserRole entity's own doc comment) and the audit rows. A user left without a role could never
    // sign in, and with no role field on UpdateUserDto it could only be repaired through addRoles.
    return this.users.manager.transaction(async (manager) => {
      const saved = await manager.getRepository(User).save(user);

      await this.userRoles.addRolesToUser(saved.id, dto.roleIds, manager, actorId);

      await this.audit.record(
        {
          moduleName: "users",
          entityId: saved.id,
          action: "CREATE",
          newValue: saved,
          performedBy: actorId,
        },
        manager,
      );

      return saved;
    });
  }

  async findAll(
    query: UserQueryDto,
  ) {
    // Deliberately NO join to user_roles on this query: a user holding N roles would come back as N
    // rows, and skip/take would then page and count rows instead of users. It stays one row per user
    // by construction, and each page's roles are attached afterwards in one batched query below.
    const qb = this.users.createQueryBuilder("user");

    // One search box (matching Role Management's own single-search layout) must match a name,
    // email, mobile number, OR the name of ANY role the user holds — an OR across all four, not four
    // independent AND'd filters (the old search.fullName/search.email/search.mobile/search.role
    // behavior). The role leg is an EXISTS, not a join, for the reason above — and so a match on one
    // role never hides the user's other roles from the response.
    if (query["search.query"]) {
      qb.andWhere(
        `(
          CONCAT(
            COALESCE(user.firstName, ''),
            ' ',
            COALESCE(user.middleName, ''),
            ' ',
            COALESCE(user.lastName, '')
          ) LIKE :term
          OR user.email LIKE :term
          OR user.mobile LIKE :term
          OR EXISTS (
            SELECT 1
            FROM user_roles ur
            INNER JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
            WHERE ur.user_id = user.id
              AND ur.deleted_at IS NULL
              AND r.role_name LIKE :term
          )
        )`,
        {
          term: `%${query["search.query"]}%`,
        },
      );
    }

    if (query.status) {
      qb.andWhere("user.active = :active", { active: query.status === "active" });
    }

    // EXISTS for the same reason as the search leg: a join would return one row per role held.
    if (query.roleId) {
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM user_roles ur_filter
          INNER JOIN roles r_filter ON r_filter.id = ur_filter.role_id AND r_filter.deleted_at IS NULL
          WHERE ur_filter.user_id = user.id
            AND ur_filter.deleted_at IS NULL
            AND ur_filter.role_id = :filterRoleId
        )`,
        { filterRoleId: query.roleId },
      );
    }

    const allowedSortColumns = {
      fullName: "user.firstName",
      email: "user.email",
      mobile: "user.mobile",
      active: "user.active",
      employeeCode:
        "user.employeeCode",
      createdAt:
        "user.createdAt",
      // The user's PRIMARY role by name — selected below as this alias (see the addSelect).
      roles: "primary_role_name",
    } as const;

    if (query.sortBy === "roles") {
      // A correlated subquery exposed as a selected alias, not a join, so the page still holds one row
      // per user — and an alias (not a raw expression in ORDER BY) is what TypeORM can page safely.
      qb.addSelect(
        `(
          SELECT r_sort.role_name
          FROM user_roles ur_sort
          INNER JOIN roles r_sort ON r_sort.id = ur_sort.role_id AND r_sort.deleted_at IS NULL
          WHERE ur_sort.user_id = user.id AND ur_sort.deleted_at IS NULL
          ORDER BY ur_sort.id ASC
          LIMIT 1
        )`,
        "primary_role_name",
      );
    }

    const sortColumn =
      allowedSortColumns[
      (query.sortBy ??
        "createdAt") as keyof typeof allowedSortColumns
      ] ?? "user.createdAt";

    const sortOrder =
      query.sortOrder === "ASC"
        ? "ASC"
        : "DESC";

    qb.orderBy(
      sortColumn,
      sortOrder,
    );

    const result =
      await paginate(
        qb,
        query,
      );

    // One query for the whole page, not one per row — see UserRoleService.getRolesForUsers.
    const rolesByUserId = result.items.length
      ? await this.userRoles.getRolesForUsers(result.items.map((user) => user.id))
      : new Map<number, Role[]>();

    return {
      ...result,

      items: result.items.map((user: User) => {
        const roles = rolesByUserId.get(user.id) ?? [];

        return {
          ...user,

          // `role` is the PRIMARY (first by assignment order), kept as it always was; `roles` is
          // every role the user holds, in that same order.
          role: roles[0] ?? null,
          roles: roles.map((role) => ({ id: role.id, roleName: role.roleName })),

          fullName: [
            user.firstName,
            user.middleName,
            user.lastName,
          ]
            .filter(Boolean)
            .join(" "),
        };
      }),
    };
  }

  /** The options behind the Users list's filter dropdowns, served from the Users module itself so a viewer
   *  who can list users (VIEW_USER) never needs access to Role Management just to filter by role. */
  async getFilterOptions() {
    const roles = await this.roles.getRoleFilter();
    return {
      roles,
      statuses: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    };
  }

  async findOne(id: number): Promise<UserWithRoles> {
    const user = await this.users.findOne({
      where: { id },
      relations: {
        reportingManager: true,
      },
    });


    if (!user) {
      throw new NotFoundException("User not found");
    }

    // user_roles is the only source of a user's roles — see UserRole entity's own doc comment.
    // JwtStrategy.validate reads `roles` from this on every request to build the principal, so it
    // must stay a single live read, never cached.
    const roles = await this.userRoles.getRolesForUser(id);

    return Object.assign(user, { role: roles[0] ?? null, roles });
  }

  private async getActiveUsersByRoleCapability(capability: 'canBeReportingManager' | 'canBeFieldInspector') {
    const grants = await this.userRoles.getUsersByRoleCapability(capability);
    if (grants.length === 0) return [];

    // A user holding several qualifying roles has several rows; `grants` is in assignment order, so
    // keeping the first makes the displayed role name deterministic instead of whichever row the
    // Map happened to see last. Keying by user id is also what keeps each user in the result once.
    const roleNameByUserId = new Map<number, string>();
    for (const grant of grants) {
      if (!roleNameByUserId.has(grant.userId)) roleNameByUserId.set(grant.userId, grant.roleName);
    }

    const users = await this.users.find({
      where: { id: In([...roleNameByUserId.keys()]), active: true },
      order: { firstName: 'ASC' },
    });

    return users.map((user) => ({ user, roleName: roleNameByUserId.get(user.id) ?? null }));
  }

  async getReportingManagers() {
    const rows = await this.getActiveUsersByRoleCapability('canBeReportingManager');

    return rows.map(({ user, roleName }) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      employeeCode: user.employeeCode,
      roleName,
    }));
  }

  // Same pattern as getReportingManagers above, filtered on the sibling canBeFieldInspector flag —
  // the real "who can this field-inspection request be assigned to" picker for Request Field
  // Inspection's Assign To field (CCB_Web/components/billing-readiness/FieldInspectionModal.tsx).
  async getFieldInspectors() {
    const rows = await this.getActiveUsersByRoleCapability('canBeFieldInspector');

    return rows.map(({ user, roleName }) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      employeeCode: user.employeeCode,
      roleName,
    }));
  }

  async getProfile(id: number) {
    const user = await this.findOne(id);

    // findOne already read the live role set, so `role` and `roles` here can never disagree.
    const [primaryRole] = user.roles;
    if (!primaryRole) {
      throw new NotFoundException('No role assigned to this user');
    }
    // The legacy navigation tree is still resolved for the PRIMARY role only (RolePermissionsService
    // has no multi-role form of it). It is display data — authorization reads live Policies instead
    // (PermissionGuard, GET /auth/me/actions).
    const permissions = await this.rolePermissionService.getUserPermissions(primaryRole.id);

    return {
      id: user.id,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      email: user.email,
      employeeCode: user.employeeCode,
      designation: user.designation,

      role: {
        id: primaryRole.id,
        name: primaryRole.roleName,
      },
      roles: user.roles.map((role) => ({ id: role.id, name: role.roleName })),

      themeMode: user.themeMode ?? null,
      navTheme: user.navTheme ?? null,
      preferredLanguageCode: user.preferredLanguageCode ?? null,

      permissions,
    };
  }

  async updateOwnPreferences(id: number, dto: UpdatePreferencesDto) {
    const user = await this.findOne(id);

    if (dto.themeMode !== undefined) user.themeMode = dto.themeMode;
    if (dto.navTheme !== undefined) user.navTheme = dto.navTheme;

    if (dto.preferredLanguageCode !== undefined) {
      const languages = await this.lov.findActiveLanguages();
      const isValid = languages.some((l) => l.code === dto.preferredLanguageCode);
      if (!isValid) {
        throw new BadRequestException(
          `"${dto.preferredLanguageCode}" is not an active language — configure it in Lookup Field Master first`,
        );
      }
      user.preferredLanguageCode = dto.preferredLanguageCode;
    }

    await this.users.save(user);

    return {
      themeMode: user.themeMode ?? null,
      navTheme: user.navTheme ?? null,
      preferredLanguageCode: user.preferredLanguageCode ?? null,
    };
  }

  /** Narrowly-scoped shape (addSelect the hidden passwordHash column) for AuthService.login, which
   *  needs only identity/credential fields here — the user's role comes from UserRoleService, not
   *  from this query (see AuthService.login's own doc comment). */
  findByEmailWithPasswordHash(email: string) {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  /**
   * Same narrowly-scoped shape as findByEmailWithRole (addSelect the hidden passwordHash column),
   * keyed by id instead of email, no role join — for AuthService.changePassword, which already has
   * the authenticated principal's id and needs only the hash to verify the current password.
   */
  findByIdWithPasswordHash(id: number) {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
  }

  /**
   * Sign-in access status for the Security Credentials tab's "Sign-in access" section — whether a
   * usable password currently exists (never the hash itself) plus when it was last set. Deliberately
   * its own narrow query rather than widening findOne's response shape, since passwordHash is
   * select:false everywhere else and this is the one legitimate reason to peek at its presence (not
   * its value) for an admin viewing another user.
   */
  async getSigninAccessStatus(id: number): Promise<{ signinAccessEnabled: boolean; passwordUpdatedAt: Date | null }> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      signinAccessEnabled: !!user.passwordHash,
      passwordUpdatedAt: user.passwordUpdatedAt ?? null,
    };
  }

  // Always clears mustChangePassword alongside the hash — whether this password change was the
  // mandatory one (AuthService's own flow redirected them here) or a voluntary one from an already
  // fully-logged-in user, they've just demonstrated they can set a real password, so there is never
  // a case where the flag should survive a successful change. Self-service only — see
  // adminSetPasswordHash below for the admin-on-another-user equivalent, which does NOT share this
  // always-false behavior (an admin reset can deliberately set mustChangePassword: true).
  async setPasswordHash(userId: number, passwordHash: string): Promise<void> {
    await this.users.update(userId, { passwordHash, mustChangePassword: false, passwordUpdatedAt: new Date() });
  }

  // Admin-triggered password reset for ANOTHER user (AuthService.adminResetPassword). Deliberately a
  // separate method from setPasswordHash above rather than a shared one with an extra parameter —
  // that method's "always clear mustChangePassword" behavior is specific to the self-service "I just
  // proved I know my new password" case, which does not apply here: an admin reset's whole point can
  // be to FORCE mustChangePassword back to true, the opposite of setPasswordHash's own contract.
  async adminSetPasswordHash(userId: number, passwordHash: string, mustChangePassword: boolean): Promise<void> {
    await this.users.update(userId, { passwordHash, mustChangePassword, passwordUpdatedAt: new Date() });
  }

  // Admin-triggered "disable sign-in access" (AuthService.disableSigninAccess) — invalidates the
  // CURRENT password without touching `active`, so the user still exists and shows as active
  // everywhere else, but can no longer sign in (AuthService.login's own bcrypt.compare against a
  // null/undefined hash never throws, it just returns false — confirmed safe, see its own comment).
  // Distinct from account deactivation (the existing `active` field, toggled via ordinary
  // UpdateUserDto) — this is specifically a credentials action, never touching account enablement.
  async clearPasswordHash(userId: number): Promise<void> {
    await this.users.update(userId, { passwordHash: null, passwordUpdatedAt: new Date() });
  }

  async updateLastLogin(
    userId: number,
  ): Promise<void> {
    await this.users.update(
      userId,
      {
        lastLoginAt:
          new Date(),
      },
    );
  }


  /**
   * Never touches roles: UpdateUserDto has no role field (the global whitelist/forbidNonWhitelisted
   * pipe answers one with a 400), and nothing here reads one either. Every role change goes through
   * addRoles/removeRole — the one path that enforces the self-change, last-role and last-SUPER_ADMIN
   * rules and writes the ASSIGN_ROLE/REVOKE_ROLE audit row. A profile save that could also edit
   * roles would be a second, unguarded way around all of them.
   */
  async update(id: number, dto: UpdateUserDto, actorId?: number) {
    const user = await this.findOne(id);
    const oldValue = { ...user };
    await this.validateUniqueFields(
      dto,
      id,
    );
    await this.assertDynamicRequiredFields(dto);

    if ('reportingManagerId' in dto) {
      user.reportingManager = dto.reportingManagerId
        ? (await this.users.findOne({ where: { id: dto.reportingManagerId } })) ?? undefined
        : undefined;
    }
    Object.assign(user, {
      firstName:
        dto.firstName ??
        user.firstName,

      middleName:
        dto.middleName ??
        user.middleName,

      lastName:
        dto.lastName ??
        user.lastName,

      designation:
        dto.designation ??
        user.designation,

      email:
        dto.email ??
        user.email,

      mobile:
        dto.mobile ??
        user.mobile,

      active:
        dto.active ??
        user.active,

      employeeCode:
        dto.employeeCode ??
        user.employeeCode,
    });
    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 12);
      user.passwordUpdatedAt = new Date();
    }
    const saved = await this.users.save(user);

    await this.audit.record({ moduleName: 'users', entityId: id, action: 'UPDATE', oldValue, newValue: saved, performedBy: actorId });
    return saved;
  }

  /**
   * POST /users/:id/roles — grants roles to an existing user, additively and idempotently (a role
   * they already hold is skipped, not an error). An actor cannot grant roles to their OWN user: that
   * is self-escalation with no second party accountable for it (a request that would change nothing
   * stays allowed). That rule, and the audit row, are enforced inside UserRoleService.addRolesToUser's
   * own transaction, where "would this change anything" can be decided against the rows being
   * written — see that method for why they live there rather than here. Existence is checked first,
   * so a request naming one unknown role never applies partially. Returns the user's full roles
   * array AFTER the change (the same shape as findOne's `roles`), so a caller can replace its copy
   * without a refetch.
   */
  async addRoles(userId: number, roleIds: number[], actorId?: number): Promise<Role[]> {
    await this.assertUserExists(userId);
    await this.assertRolesExist(roleIds);

    await this.userRoles.addRolesToUser(userId, roleIds, undefined, actorId);

    return this.userRoles.getRolesForUser(userId);
  }

  /**
   * DELETE /users/:id/roles/:roleId — revokes ONE role, idempotently (a role the user does not hold
   * is a no-op, not a 404 — including a role id that does not exist at all, which no one can hold).
   * Three rules apply, enforced inside UserRoleService.removeRoleFromUser's own transaction against
   * locked rows (see that method for the locking, and for why the row is hard-deleted — the unique
   * (user_id, role_id) key ignores deleted_at, so a soft-deleted row would block re-granting):
   *   - no self-change: role changes are made by someone else, so a second party is accountable;
   *   - a user must keep at least one role: login and JwtStrategy reject a role-less user, so
   *     removing the last one is an instant lock-out;
   *   - the last SUPER_ADMIN cannot be demoted: every admin-only surface, user/role management
   *     included, would be left with no one able to grant it back.
   * Returns the user's full roles array AFTER the change.
   */
  async removeRole(userId: number, roleId: number, actorId?: number): Promise<Role[]> {
    await this.assertUserExists(userId);

    await this.userRoles.removeRoleFromUser(userId, roleId, undefined, actorId);

    return this.userRoles.getRolesForUser(userId);
  }

  private async assertUserExists(id: number): Promise<void> {
    const user = await this.users.findOne({ where: { id }, select: { id: true } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
  }

  /** RoleService.findOne throws NotFoundException('Role not found') for an unknown id. */
  private async assertRolesExist(roleIds: number[]): Promise<void> {
    await Promise.all([...new Set(roleIds)].map((roleId) => this.roles.findOne(roleId)));
  }

  private async validateUniqueFields(
    dto: {
      email?: string;
      mobile?: string;
      employeeCode?: string;
    },
    excludeUserId?: number,
  ) {
    if (dto.email) {
      const existingEmail =
        await this.users.findOne({
          where: {
            email: dto.email,
          },
        });

      if (
        existingEmail &&
        existingEmail.id !==
        excludeUserId
      ) {
        throw new ConflictException(
          'Email already exists',
        );
      }
    }

    if (dto.mobile) {
      const existingMobile =
        await this.users.findOne({
          where: {
            mobile: dto.mobile,
          },
        });

      if (
        existingMobile &&
        existingMobile.id !==
        excludeUserId
      ) {
        throw new ConflictException(
          'Mobile number already exists',
        );
      }
    }

    if (dto.employeeCode) {
      const existingEmployee =
        await this.users.findOne({
          where: {
            employeeCode:
              dto.employeeCode,
          },
        });

      if (
        existingEmployee &&
        existingEmployee.id !==
        excludeUserId
      ) {
        throw new ConflictException(
          'Employee code already exists',
        );
      }
    }
  }

  async remove(id: number, actorId?: number) {
    const user = await this.findOne(id);
    await this.users.softRemove(user);
    await this.audit.record({ moduleName: 'users', entityId: id, action: 'DELETE', oldValue: user, performedBy: actorId });
  }


}

