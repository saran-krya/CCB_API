import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { In, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/utils/pagination.util';
import { RoleService } from '../role/role.service';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { User } from './entities/user.entity';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { AttributeService } from '../attribute/attribute.service';
import { LovService } from '../lov/lov.service';
import { UserRoleService } from '../user-role/user-role.service';

interface DynamicFieldRequirement {
  field: keyof CreateUserDto;
  attributeKey: string;
  label: string;
}

const DYNAMIC_FIELD_REQUIREMENTS: DynamicFieldRequirement[] = [
  { field: 'reportingManagerId', attributeKey: 'REPORTING_MANAGER_MANDATORY', label: 'Reporting Manager' },
];

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

    const role =
      await this.roles.findOne(
        dto.roleId,
      );


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

    const saved =
      await this.users.save(user);

    // user_roles is the only place a user's role is recorded — see UserRole entity's own doc
    // comment.
    await this.userRoles.setPrimaryRole(saved.id, role.id);

    await this.audit.record({
      moduleName: "users",
      entityId: saved.id,
      action: "CREATE",
      newValue: saved,
      performedBy: actorId,
    });

    return saved;
  }

  async findAll(
    query: PaginationQueryDto,
  ) {
    const qb = this.users
      .createQueryBuilder("user")
      .leftJoin(
        "user_roles",
        "user_role",
        "user_role.user_id = user.id AND user_role.deleted_at IS NULL",
      )
      .leftJoinAndMapOne(
        "user.role",
        "roles",
        "role",
        "role.id = user_role.role_id",
      );


    if (query["search.fullName"]) {
      qb.andWhere(
        `
      CONCAT(
        COALESCE(user.firstName, ''),
        ' ',
        COALESCE(user.middleName, ''),
        ' ',
        COALESCE(user.lastName, '')
      ) LIKE :fullName
      `,
        {
          fullName: `%${query["search.fullName"]}%`,
        },
      );
    }


    if (query["search.email"]) {
      qb.andWhere(
        "user.email LIKE :email",
        {
          email: `%${query["search.email"]}%`,
        },
      );
    }


    if (query["search.mobile"]) {
      qb.andWhere(
        "user.mobile LIKE :mobile",
        {
          mobile: `%${query["search.mobile"]}%`,
        },
      );
    }


    if (query["search.role"]) {
      const roles =
        query["search.role"].split(",");

      qb.andWhere(
        "role.roleName IN (:...roles)",
        {
          roles,
        },
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
    } as const;

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

    result.items =
      result.items.map(
        (user: User) => ({
          ...user,

          fullName: [
            user.firstName,
            user.middleName,
            user.lastName,
          ]
            .filter(Boolean)
            .join(" "),
        }),
      );

    return result;
  }
  async findOne(id: number) {
    const user = await this.users.findOne({
      where: { id },
      relations: {
        reportingManager: true,
      },
    });


    if (!user) {
      throw new NotFoundException("User not found");
    }

    // user_roles is the only source of a user's role — see UserRole entity's own doc comment.
    // A user has exactly one role today, so the first (and only) row is the detail-screen's `role`.
    const [role] = await this.userRoles.getRolesForUser(id);
    (user as User & { role: typeof role | null }).role = role ?? null;

    return user;
  }

  private async getActiveUsersByRoleCapability(capability: 'canBeReportingManager' | 'canBeFieldInspector') {
    const grants = await this.userRoles.getUsersByRoleCapability(capability);
    if (grants.length === 0) return [];
    const roleNameByUserId = new Map(grants.map((g) => [g.userId, g.roleName]));

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

    const primaryRole = await this.userRoles.getPrimaryRole(id);
    if (!primaryRole) {
      throw new NotFoundException('No role assigned to this user');
    }
    const permissions = await this.rolePermissionService.getUserPermissions(primaryRole.roleId);

    return {
      id: user.id,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      email: user.email,
      employeeCode: user.employeeCode,
      designation: user.designation,

      role: {
        id: primaryRole.roleId,
        name: primaryRole.roleName,
      },

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

  async setPasswordHash(userId: number, passwordHash: string): Promise<void> {
    await this.users.update(userId, { passwordHash });
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


  async update(id: number, dto: UpdateUserDto, actorId?: number) {
    const user = await this.findOne(id);
    const oldValue = { ...user };
    await this.validateUniqueFields(
      dto,
      id,
    );
    await this.assertDynamicRequiredFields(dto);
    if (dto.roleId) {
      // Validates the role exists (throws NotFoundException otherwise) before setPrimaryRole below
      // writes it — user_roles is the only place a user's role is recorded, see create()'s same note.
      await this.roles.findOne(dto.roleId);
    }

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
    }
    const saved = await this.users.save(user);

    if (dto.roleId) {
      await this.userRoles.setPrimaryRole(saved.id, dto.roleId);
    }

    await this.audit.record({ moduleName: 'users', entityId: id, action: 'UPDATE', oldValue, newValue: saved, performedBy: actorId });
    return saved;
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


  async getDashboard() {
    const totalUsers =
      await this.users.count();

    const activeUsers =
      await this.users.count({
        where: {
          active: true,
        },
      });

    const inactiveUsers =
      await this.users.count({
        where: {
          active: false,
        },
      });

    const adminUsers =
      await this.users
        .createQueryBuilder("user")
        .innerJoin("user_roles", "user_role", "user_role.user_id = user.id AND user_role.deleted_at IS NULL")
        .innerJoin("roles", "role", "role.id = user_role.role_id")
        .where(
          "role.roleName IN (:...roles)",
          {
            roles: [
              "SUPER_ADMIN",
              "ADMIN",
            ],
          }
        )
        .getCount();

    const roleDistribution =
      await this.users
        .createQueryBuilder("user")
        .innerJoin("user_roles", "user_role", "user_role.user_id = user.id AND user_role.deleted_at IS NULL")
        .innerJoin("roles", "role", "role.id = user_role.role_id")
        .select(
          "role.roleName",
          "role"
        )
        .addSelect(
          "COUNT(user.id)",
          "count"
        )
        .groupBy("role.roleName")
        .getRawMany();

    return {
      summary: {
        totalUsers,
        activeUsers,
        inactiveUsers,
        adminUsers,
      },

      analytics: {
        roleDistribution,
      },
    };
  }
}

