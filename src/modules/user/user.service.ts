import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/utils/pagination.util';
import { RoleService } from '../role/role.service';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { User } from './entities/user.entity';
import { BusinessRole } from '../business-role/entities/business-role.entity';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { AttributeService } from '../attribute/attribute.service';

// User Creation Rules (Module Attributes > User Management) that make a
// field conditionally mandatory. Add an entry here — plus the matching
// boolean attribute in AttributeService's seed — to make any other user
// field (Department, Designation, Phone, Employee ID, ...) dynamically
// required the same way, with no other code changes. The frontend mirrors
// this exact list in components/validation/dynamic-field-requirements.ts.
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

    @InjectRepository(BusinessRole)
    private readonly businessRoles: Repository<BusinessRole>,

    private readonly rolePermissionService: RolePermissionsService,

    private readonly roles: RoleService,

    private readonly audit: AuditService,

    private readonly attributes: AttributeService,
  ) { }

  // Checks every field in DYNAMIC_FIELD_REQUIREMENTS that's present on this
  // dto against its Module Attribute — only fields actually being set are
  // validated, so a partial update() that doesn't touch a given field
  // doesn't force it to be (re)filled.
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


    const businessRole =
      dto.businessRoleId
        ? await this.businessRoles.findOne({
          where: {
            id: dto.businessRoleId,
          },
        })
        : null;

    const reportingManager =
      dto.reportingManagerId
        ? await this.users.findOne({
          where: {
            id: dto.reportingManagerId,
          },
        })
        : null;

    const user = new User();

    user.role = role;
    user.businessRole =
      businessRole ?? undefined;

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
      .leftJoinAndSelect(
        "user.role",
        "role",
      );

    // Full Name Search

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

    // Email Search

    if (query["search.email"]) {
      qb.andWhere(
        "user.email LIKE :email",
        {
          email: `%${query["search.email"]}%`,
        },
      );
    }

    // Mobile Search

    if (query["search.mobile"]) {
      qb.andWhere(
        "user.mobile LIKE :mobile",
        {
          mobile: `%${query["search.mobile"]}%`,
        },
      );
    }

    // Role Search

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
        role: true,
        businessRole: true,
        reportingManager: true,
      },
    });


    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  async getReportingManagers() {
    const users = await this.users
      .createQueryBuilder("user")
      .leftJoinAndSelect(
        "user.role",
        "role",
      )
      .where(
        "user.active = :active",
        {
          active: true,
        },
      )
      .andWhere(
        "role.canBeReportingManager = :can",
        {
          can: true,
        },
      )
      .orderBy(
        "user.firstName",
        "ASC",
      )
      .getMany();

    return users.map((user) => ({
      id: user.id,
      name: [
        user.firstName,
        user.middleName,
        user.lastName,
      ]
        .filter(Boolean)
        .join(" "),
      employeeCode:
        user.employeeCode,
    }));
  }
  async getProfile(id: number) {
    const user = await this.findOne(id);

    // Every role, including SUPER_ADMIN/ADMIN, gets its permission tree from
    // real granted RolePermission rows — no role-name bypass. SUPER_ADMIN/
    // ADMIN are seeded with grants for every action except the approve/
    // reject exclusions (BootstrapService/RolePermissionsService's
    // ensureAdminGrants), so their day-to-day access is unchanged; it now
    // comes from the same rows the backend PermissionGuard checks, instead
    // of a hardcoded "force everything true" path.
    const permissions = await this.rolePermissionService.getUserPermissions(user.role.id);

    return {
      id: user.id,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      email: user.email,
      employeeCode: user.employeeCode,
      designation: user.designation,

      role: {
        id: user.role.id,
        name: user.role.roleName,
      },

      themeMode: user.themeMode ?? null,
      navTheme: user.navTheme ?? null,

      permissions,
    };
  }

  async updateOwnPreferences(id: number, dto: UpdatePreferencesDto) {
    const user = await this.findOne(id);

    if (dto.themeMode !== undefined) user.themeMode = dto.themeMode;
    if (dto.navTheme !== undefined) user.navTheme = dto.navTheme;

    await this.users.save(user);

    return {
      themeMode: user.themeMode ?? null,
      navTheme: user.navTheme ?? null,
    };
  }

  findByEmailWithRole(email: string) {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.role', 'role')
      .where('user.email = :email', { email })
      .getOne();
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
      user.role = await this.roles.findOne(dto.roleId);
    }
    if (dto.businessRoleId) {
      const businessRole =
        await this.businessRoles.findOne({
          where: {
            id: dto.businessRoleId,
          },
        });

      if (businessRole) {
        user.businessRole =
          businessRole;
      }
    }


    // Was previously commented out entirely, meaning an edit could never
    // actually change (or clear) a user's Reporting Manager. Checks
    // "in dto" rather than truthiness so an explicit null (clear the
    // manager) is honored, not just ignored as "not provided".
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
        .leftJoin("user.role", "role")
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
        .leftJoin("user.role", "role")
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

