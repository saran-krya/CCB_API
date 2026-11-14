import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';
import { paginate } from '../../common/utils/pagination.util';
import { releaseSoftDeletedUnique } from '../../common/utils/release-soft-deleted-unique';
import { Actor, actorUserId, SUPER_ADMIN_ASSIGN_MESSAGE, isSuperAdminActor } from '../../common/security/actor';
import { ADMINISTRATOR_ROLES, isAdministratorRoleName } from '../../common/security/administrator-roles';
import { RoleService } from '../role/role.service';
import { Role } from '../role/entities/role.entity';
import { UserInlinePolicy } from '../iam/entities/user-inline-policy.entity';
import { UserRole } from '../user-role/entities/user-role.entity';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { User } from './entities/user.entity';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { AttributeService } from '../attribute/attribute.service';
import { LovService } from '../lov/lov.service';
import { UserRoleService } from '../user-role/user-role.service';
import { ATTRIBUTE_KEY } from '../attribute/attribute.constants';
import { AUDIT_MODULE, AUDIT_ACTION } from '../../audit/audit.constants';
import { SORT_ORDER } from '../../common/constants/sort.constants';
import { ERROR_MESSAGES } from '../../common/constants/error-messages.constants';
import { PRINCIPAL_TYPE, PASSWORD_HASH_ROUNDS, ACTOR_KIND } from '../../common/constants/auth.constants';

interface DynamicFieldRequirement {
  // keyof UpdateUserDto, not CreateUserDto: both create and update are checked, and `roleIds` (the
  // one create-only field) is never a dynamically-required one.
  field: keyof UpdateUserDto;
  attributeKey: string;
  label: string;
}

const DYNAMIC_FIELD_REQUIREMENTS: DynamicFieldRequirement[] = [
  { field: 'reportingManagerId', attributeKey: ATTRIBUTE_KEY.REPORTING_MANAGER_MANDATORY, label: 'Reporting Manager' },
];

/** A User plus its current role assignment, attached at query time (never persisted — see the note on
 *  the User entity). `roles` is every role the user holds in assignment order; `role` is the first of
 *  them (the PRIMARY), null when there is none, kept for compatibility with callers that predate
 *  multi-role. */
export type UserWithRoles = User & { role: Role | null; roles: Role[] };

/** What a signed-in request needs to know about its user, resolved on EVERY request by JwtStrategy. */
export interface UserAuthState {
  id: number;
  active: boolean;
  mustChangePassword: boolean;
  roles: Array<{ id: number; roleName: string }>;
}

/** The credential hash must never leave the service layer — not in a response, not in an audit row. */
const withoutPasswordHash = <T extends { passwordHash?: unknown }>(user: T): Omit<T, 'passwordHash'> => {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
};

/** The users columns a person may change about THEMSELVES (Settings > My Profile) — see UpdateOwnProfileDto. */
const OWN_PROFILE_FIELDS = ['firstName', 'middleName', 'lastName', 'mobile'] as const;
type OwnProfileValues = Pick<User, (typeof OWN_PROFILE_FIELDS)[number]>;

/** What PATCH /users/me/profile answers with: the four editable values, an unset optional one as null. */
const toOwnProfile = (values: OwnProfileValues) => ({
  firstName: values.firstName,
  middleName: values.middleName ?? null,
  lastName: values.lastName,
  mobile: values.mobile ?? null,
});

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

  /**
   * `actor` is the signed-in user creating the account (never trusted from the request body). Only a
   * super administrator (SUPER_ADMIN) may create an account that holds the
   * SUPER_ADMIN role — CREATE_USER on its own carries no such authority, so a delegated administrator ("ADMIN")
   * cannot mint a super administrator. Checked before anything is written, and again authoritatively inside
   * UserRoleService.addRolesToUser in the same transaction.
   */
  async create(
    dto: CreateUserDto,
    actor: Actor,
  ) {
    await this.validateUniqueFields(dto);
    await this.assertDynamicRequiredFields(dto);

    // Before anything is written, so one unknown role id can never leave a half-created user behind.
    this.assertMayGrant(actor, await this.loadRoles(dto.roleIds));

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
          PASSWORD_HASH_ROUNDS,
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
      // A deleted account must not keep its email/mobile/employee code reserved forever.
      await this.releaseDeletedHolders(manager, dto);

      const saved = await manager.getRepository(User).save(user);

      await this.userRoles.addRolesToUser(saved.id, dto.roleIds, manager, actor);

      const safe = withoutPasswordHash(saved);
      await this.audit.record(
        {
          moduleName: AUDIT_MODULE.USERS,
          entityId: saved.id,
          action: AUDIT_ACTION.CREATE,
          newValue: safe,
          performedBy: actorUserId(actor),
        },
        manager,
      );

      return safe;
    });
  }

  async findAll(
    query: UserQueryDto,
    actor?: Actor,
  ) {
    // Deliberately NO join to user_roles on this query: a user holding N roles would come back as N
    // rows, and skip/take would then page and count rows instead of users. It stays one row per user
    // by construction, and each page's roles are attached afterwards in one batched query below.
    const qb = this.users.createQueryBuilder("user");

    // A viewer who is not a super administrator never sees a SUPER_ADMIN account — not in the list, not in the count. NOT EXISTS for the same
    // reason as the other role predicates below (a join would multiply rows); BINARY so only the exact administrator role name counts. With no
    // viewer (an internal caller) nothing is hidden.
    if (actor !== undefined && !isSuperAdminActor(actor)) {
      ADMINISTRATOR_ROLES.forEach((name, index) =>
        qb.andWhere(
          `NOT EXISTS (
            SELECT 1
            FROM user_roles ur_admin
            INNER JOIN roles r_admin ON r_admin.id = ur_admin.role_id AND r_admin.deleted_at IS NULL
            WHERE ur_admin.user_id = user.id
              AND ur_admin.deleted_at IS NULL
              AND BINARY r_admin.role_name = :administratorRole${index}
          )`,
          { [`administratorRole${index}`]: name },
        ),
      );
    }

    // One search box (matching Role Management's own single-search layout) must match a name,
    // email, mobile number, OR the name of ANY role the user holds — an OR across all four, not four
    // independent AND'd filters (the old search.fullName/search.email/search.mobile/search.role
    // behavior). The role leg is an EXISTS, not a join, for the reason above — and so a match on one
    // role never hides the user's other roles from the response.
    //
    // The name leg matches the name as it is DISPLAYED — "First Last", or "First Middle Last" when there is a middle name.
    // CONCAT_WS skips a NULL part and NULLIF(TRIM(..), '') turns a blank one into NULL (the forms store '' for "no middle
    // name", the seeded admin has NULL), so a plain "John Doe" is never missed because of a doubled space. The term gets the
    // same single-space form — ends trimmed, inner runs of whitespace collapsed — and a term of only spaces is no search.
    const term = query["search.query"]?.trim().replace(/\s+/g, " ");
    if (term) {
      qb.andWhere(
        `(
          CONCAT_WS(
            ' ',
            NULLIF(TRIM(user.firstName), ''),
            NULLIF(TRIM(user.middleName), ''),
            NULLIF(TRIM(user.lastName), '')
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
          term: `%${term}%`,
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
      query.sortOrder === SORT_ORDER.ASC
        ? SORT_ORDER.ASC
        : SORT_ORDER.DESC;

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
  async getFilterOptions(actor?: Actor) {
    const roles = await this.roles.getRoleFilter(actor);
    return {
      roles,
      statuses: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    };
  }

  async findOne(id: number, actor?: Actor): Promise<UserWithRoles> {
    const user = await this.users.findOne({
      where: { id },
      relations: {
        reportingManager: true,
      },
    });


    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // user_roles is the only source of a user's roles — see UserRole entity's own doc comment.
    // Every caller that DECIDES access must treat this as a single live read, never cached.
    const roles = await this.userRoles.getRolesForUser(id);

    // A SUPER_ADMIN account does not exist for a viewer who is not a super administrator (404, so its existence is not confirmed). Internal
    // callers pass no viewer and see everyone.
    if (actor !== undefined && !isSuperAdminActor(actor) && roles.some((role) => isAdministratorRoleName(role.roleName))) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return Object.assign(user, { role: roles[0] ?? null, roles });
  }

  /**
   * What JwtStrategy resolves on EVERY authenticated request: whether the account is still active, whether
   * a password change is required, and the user's current roles. Two lean queries — the user's three
   * needed columns and the roles' id/name — instead of findOne's full row, reporting-manager join and
   * eager role relations. Deliberately uncached: a deactivation, role revocation or password-change flag
   * must take effect on the very next request, which is exactly what makes revocation immediate.
   */
  async findAuthState(id: number): Promise<UserAuthState> {
    const user = await this.users.findOne({
      where: { id },
      select: { id: true, active: true, mustChangePassword: true },
      loadEagerRelations: false,
    });
    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }
    const roles = await this.userRoles.getRoleRefsForUser(id);
    return { id: user.id, active: user.active, mustChangePassword: user.mustChangePassword === true, roles };
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
      order: { firstName: SORT_ORDER.ASC },
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
      mobile: user.mobile ?? null,
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

  /**
   * A user's own name and mobile number — nothing else about the account (see UpdateOwnProfileDto). Only what the request really
   * changes is written, and it is audited like any user edit — but only when something changed, and the audit row carries just
   * the caller's own changed fields (previous and new value), never the whole users row with its reporting manager and roles.
   */
  async updateOwnProfile(id: number, dto: UpdateOwnProfileDto) {
    // The four editable columns only: no reporting-manager join, no role lookup, nothing else of the account to snapshot.
    const current = await this.users.findOne({
      where: { id },
      select: { id: true, firstName: true, middleName: true, lastName: true, mobile: true },
      loadEagerRelations: false,
    });
    if (!current) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // A change is a field that was sent AND differs from what is stored: a missing (or null) field means "leave it", a value
    // equal to the stored one changes nothing, and a blank middle name is "none" whether it is stored as '' or as NULL.
    const patch: Partial<OwnProfileValues> = {};
    const previous: Partial<OwnProfileValues> = {};
    for (const field of OWN_PROFILE_FIELDS) {
      const sent = dto[field] ?? undefined;
      if (sent === undefined || sent === (current[field] ?? '')) continue;
      Object.assign(patch, { [field]: sent });
      Object.assign(previous, { [field]: current[field] });
    }
    if (Object.keys(patch).length === 0) {
      return toOwnProfile(current);
    }

    // A new mobile number must be free (409), and a deleted account must not keep it reserved.
    const mobile = patch.mobile ?? undefined;
    if (mobile !== undefined) {
      await this.validateUniqueFields({ mobile }, id);
    }

    return this.users.manager.transaction(async (manager) => {
      if (mobile !== undefined) {
        await this.releaseDeletedHolders(manager, { mobile }, id);
      }
      await manager.getRepository(User).update(id, patch);
      await this.audit.record(
        { moduleName: AUDIT_MODULE.USERS, entityId: id, action: AUDIT_ACTION.UPDATE, oldValue: previous, newValue: patch, performedBy: id },
        manager,
      );
      return toOwnProfile({ ...current, ...patch });
    });
  }

  /**
   * PATCH /users/me/preferences. Only the columns that were sent are written, in ONE update — not a read-modify-write of the
   * whole row — so a concurrent change to anything else on the row (a second preference save, an administrator's edit) can never
   * be overwritten with a stale copy. A field left out is untouched; theme and navigation colour are written as sent, as they
   * always were. The language can also be CLEARED: null means "no personal choice", so the system default language
   * (DEFAULT_LANGUAGE) applies again — any other value must be an active code of the LANGUAGE lookup. Everything is validated
   * before anything is written. The response is what is stored afterwards, not an echo of the request.
   *
   * Always the caller's own row. Which grant a field needs follows the Settings page it is edited on: theme and navigation colour
   * need Appearance UPDATE, the language needs Regional Preferences UPDATE (it is edited on that page). The route guard only
   * checks that the caller holds one of them; every field actually sent is checked here, and a missing grant is a 403 with
   * nothing saved.
   */
  async updateOwnPreferences(actor: AuthenticatedUser, dto: UpdatePreferencesDto) {
    await this.assertMayChangeOwnPreferences(actor, dto);
    const id = actor.sub;
    const patch: Partial<Pick<User, 'themeMode' | 'navTheme' | 'preferredLanguageCode'>> = {};
    if (dto.themeMode !== undefined) patch.themeMode = dto.themeMode;
    if (dto.navTheme !== undefined) patch.navTheme = dto.navTheme;
    if (dto.preferredLanguageCode !== undefined) {
      patch.preferredLanguageCode =
        dto.preferredLanguageCode === null ? null : await this.assertActiveLanguage(dto.preferredLanguageCode);
    }

    if (Object.keys(patch).length > 0) {
      await this.users.update(id, patch);
    }

    const saved = await this.users.findOne({
      where: { id },
      select: { id: true, themeMode: true, navTheme: true, preferredLanguageCode: true },
      loadEagerRelations: false,
    });
    if (!saved) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return {
      themeMode: saved.themeMode ?? null,
      navTheme: saved.navTheme ?? null,
      preferredLanguageCode: saved.preferredLanguageCode ?? null,
    };
  }

  /** 403 unless the caller holds the UPDATE grant of every Settings page that owns a field in `dto`. */
  private async assertMayChangeOwnPreferences(actor: AuthenticatedUser, dto: UpdatePreferencesDto): Promise<void> {
    const needed = new Map<string, string>();
    if (dto.themeMode !== undefined || dto.navTheme !== undefined) {
      needed.set(ACTION_CODES.SETTINGS_APPEARANCE_UPDATE, 'Appearance Settings');
    }
    if (dto.preferredLanguageCode !== undefined) {
      needed.set(ACTION_CODES.SETTINGS_REGIONAL_UPDATE, 'Regional Preferences');
    }
    if (needed.size === 0) return;

    const granted = new Set(await this.rolePermissionService.getMyActionCodesForRoles(actor.roleIds ?? [actor.roleId], actor.sub));
    const missing = [...needed].filter(([code]) => !granted.has(code));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `You do not have permission to change ${missing.map(([, page]) => page).join(', ')}. ` +
          `Required permission: ${missing.map(([code]) => code).join(', ')}.`,
      );
    }
  }

  /** The code must be an ACTIVE entry of the LANGUAGE lookup (Lookup Field Master) — the rule a preferred language has always followed. */
  private async assertActiveLanguage(code: string): Promise<string> {
    const languages = await this.lov.findActiveLanguages();
    if (!languages.some((language) => language.code === code)) {
      throw new BadRequestException(`"${code}" is not an active language — configure it in Lookup Field Master first`);
    }
    return code;
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
   * usable password currently exists (never the hash itself) plus when it was last set. Deliberately its
   * own narrow query rather than widening findOne's response shape, since passwordHash is
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
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
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
   * Edits a user's profile fields and enabled state — nothing else:
   *  - never roles: UpdateUserDto has no role field (the global whitelist/forbidNonWhitelisted pipe
   *    answers one with a 400), so every role change goes through addRoles/removeRole, the one path that
   *    enforces the privilege, self-change, last-role and last-SUPER_ADMIN rules and writes the audit row;
   *  - never a password: it has no password field either (a password sent is a 400). A password changes
   *    only through the dedicated flows — the user's own change-password (needs the current password) and
   *    the admin reset, both of which also revoke sessions and apply the password policy.
   *
   * `actor` is the signed-in user. A SUPER_ADMIN's account can be edited only by a SUPER_ADMIN; nobody can
   * deactivate their own account; and the last active SUPER_ADMIN can never be deactivated (checked under a
   * row lock in the same transaction as the save).
   */
  async update(id: number, dto: UpdateUserDto, actor: Actor) {
    const user = await this.findOne(id);
    await this.userRoles.assertActorMayModifyUser(actor, id);

    const deactivating = dto.active === false && user.active;
    if (deactivating && actor.kind === ACTOR_KIND.USER && actor.id === id) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }

    // M10 (docs/ON_PREMISE_SUPER_ADMIN.md §11 item 6, now resolved): changing the initial administrator's e-mail
    // is a takeover vector in waiting — point future password recovery (or a mail-based 2FA reset) at an address
    // the real owner does not control, then take the account over without ever touching its password hash here.
    // assertActorMayModifyUser above is a no-op for a SUPER_ADMIN actor, exactly like the password-reset path
    // (AuthService.adminResetPassword), so this needs its own explicit check the same way that one now has.
    if (dto.email !== undefined && dto.email !== user.email) {
      await this.userRoles.assertNotInitialAdministrator(id, "change the e-mail address of");
    }

    const oldValue = withoutPasswordHash({ ...user });
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

    return this.users.manager.transaction(async (manager) => {
      if (deactivating) {
        await this.userRoles.assertNotLastActiveAdministrator(id, manager, 'deactivate');
      }
      await this.releaseDeletedHolders(manager, dto, id);

      const saved = withoutPasswordHash(await manager.getRepository(User).save(user));
      await this.audit.record(
        { moduleName: AUDIT_MODULE.USERS, entityId: id, action: AUDIT_ACTION.UPDATE, oldValue, newValue: saved, performedBy: actorUserId(actor) },
        manager,
      );
      return saved;
    });
  }

  /**
   * POST /users/:id/roles — grants roles to an existing user, additively and idempotently (a role
   * they already hold is skipped, not an error). The privilege, self-change and audit rules are enforced
   * inside UserRoleService.addRolesToUser's own transaction, where "would this change anything" can be
   * decided against the rows being written — see that method. Only a SUPER_ADMIN may grant SUPER_ADMIN
   * (403 otherwise); that is checked here first as well, so the refusal comes before any write.
   * Existence is checked first, so a request naming one unknown role never applies partially. Returns the
   * user's full roles array AFTER the change (the same shape as findOne's `roles`), so a caller can
   * replace its copy without a refetch.
   */
  async addRoles(userId: number, roleIds: number[], actor: Actor): Promise<Role[]> {
    await this.assertUserExists(userId);
    this.assertMayGrant(actor, await this.loadRoles(roleIds));

    await this.userRoles.addRolesToUser(userId, roleIds, undefined, actor);

    return this.userRoles.getRolesForUser(userId);
  }

  /**
   * DELETE /users/:id/roles/:roleId — revokes ONE role, idempotently (a role the user does not hold
   * is a no-op, not a 404 — including a role id that does not exist at all, which no one can hold).
   * The rules apply inside UserRoleService.removeRoleFromUser's own transaction against locked rows (see
   * that method for the locking, and for why the row is hard-deleted — the unique (user_id, role_id) key
   * ignores deleted_at, so a soft-deleted row would block re-granting):
   *   - only a SUPER_ADMIN may change the roles of a SUPER_ADMIN user;
   *   - no self-change: role changes are made by someone else, so a second party is accountable;
   *   - a user must keep at least one role: login and JwtStrategy reject a role-less user, so
   *     removing the last one is an instant lock-out;
   *   - the last ACTIVE SUPER_ADMIN cannot be demoted.
   * Returns the user's full roles array AFTER the change.
   */
  async removeRole(userId: number, roleId: number, actor: Actor): Promise<Role[]> {
    await this.assertUserExists(userId);

    await this.userRoles.removeRoleFromUser(userId, roleId, undefined, actor);

    return this.userRoles.getRolesForUser(userId);
  }

  private async assertUserExists(id: number): Promise<void> {
    const user = await this.users.findOne({ where: { id }, select: { id: true } });
    if (!user) {
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    }
  }

  /** RoleService.findOne throws NotFoundException('Role not found') for an unknown id. */
  private loadRoles(roleIds: number[]): Promise<Role[]> {
    return Promise.all([...new Set(roleIds)].map((roleId) => this.roles.findOne(roleId)));
  }

  /** Granting the SUPER_ADMIN role is reserved for a super administrator —
   *  EDIT_USER / CREATE_USER / ASSIGN_ROLE never carry it. */
  private assertMayGrant(actor: Actor, roles: Role[]): void {
    if (!isSuperAdminActor(actor) && roles.some((role) => isAdministratorRoleName(role.roleName))) {
      throw new ForbiddenException(SUPER_ADMIN_ASSIGN_MESSAGE);
    }
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

  /** Frees the unique values (email, mobile, employee code) that a SOFT-DELETED account still holds, so
   *  a new or edited account can use them. Runs in the caller's transaction, right before the write. */
  private async releaseDeletedHolders(
    manager: EntityManager,
    values: { email?: string; mobile?: string; employeeCode?: string },
    exceptId?: number,
  ): Promise<void> {
    await releaseSoftDeletedUnique(manager, User, 'email', values.email, { email: true, exceptId });
    await releaseSoftDeletedUnique(manager, User, 'mobile', values.mobile, { replaceWith: 'null', exceptId });
    await releaseSoftDeletedUnique(manager, User, 'employeeCode', values.employeeCode, { replaceWith: 'null', exceptId });
  }

  /**
   * Soft-deletes an account. Refused (403) for your own account, for a SUPER_ADMIN account unless the
   * actor is a SUPER_ADMIN, and for the last ACTIVE SUPER_ADMIN (checked under a row lock in the same
   * transaction). The account's dependents are cleaned up with it, in that transaction, so nothing is left
   * pointing at a deleted user: its role assignments, its own inline policies, and its live sessions
   * (refresh tokens are revoked, so no further token can be minted for it).
   */
  async remove(id: number, actor: Actor) {
    const user = await this.findOne(id);
    if (actor.kind === ACTOR_KIND.USER && actor.id === id) {
      throw new ForbiddenException('You cannot delete your own account.');
    }
    await this.userRoles.assertActorMayModifyUser(actor, id);

    await this.users.manager.transaction(async (manager) => {
      await this.userRoles.assertNotLastActiveAdministrator(id, manager, 'delete');

      await manager.getRepository(User).softRemove(user);
      await manager.getRepository(UserRole).delete({ userId: id });
      await manager.getRepository(UserInlinePolicy).delete({ userId: id });
      await manager
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ revokedAt: new Date() })
        .where('user_id = :id AND principal_type = :type AND revoked_at IS NULL', { id, type: PRINCIPAL_TYPE.STAFF })
        .execute();

      await this.audit.record(
        {
          moduleName: AUDIT_MODULE.USERS,
          entityId: id,
          action: AUDIT_ACTION.DELETE,
          oldValue: { ...withoutPasswordHash(user), roleIds: user.roles.map((role) => role.id) },
          performedBy: actorUserId(actor),
        },
        manager,
      );
    });
  }


}
