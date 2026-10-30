import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { RoleService } from '../role/role.service';
import { Role } from '../role/entities/role.entity';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { AttributeService } from '../attribute/attribute.service';
import { LovService } from '../lov/lov.service';
import { UserRoleService } from '../user-role/user-role.service';
import { UserRole } from '../user-role/entities/user-role.entity';
import { AuditService } from '../../audit/audit.service';
import { ROLES } from '../../common/constants/global';

// Isolated tests for UserService's multi-role behavior — every dependency mocked, no real database
// connection. Follows the same mocking conventions as iam.service.spec.ts (plain jest.fn() mocks per
// repo/service, wired via Test.createTestingModule + getRepositoryToken).
//
// Two setups on purpose. The role-assignment endpoints (addRoles/removeRole) put UserService on top of
// the REAL UserRoleService, over an in-memory user_roles table: the business rules (no self-change,
// last role, last SUPER_ADMIN) live in that service's transaction, so asserting them against a mocked
// UserRoleService would only prove the mock. Everything else (create, update, findOne, getProfile,
// the pickers) uses a plain mocked UserRoleService like every other service spec here.

const SUPER_ADMIN_ROLE = { id: 1, roleName: ROLES.SUPER_ADMIN };
const ADMIN_ROLE = { id: 2, roleName: ROLES.ADMIN };
const OPERATIONS_ROLE = { id: 3, roleName: ROLES.OPERATIONS };
const FINANCE_ROLE = { id: 4, roleName: ROLES.FINANCE };
const ROLE_TABLE = [SUPER_ADMIN_ROLE, ADMIN_ROLE, OPERATIONS_ROLE, FINANCE_ROLE];

// Builds the raw User row findOne's own `this.users.findOne` would return (no `role`/`roles` attached
// yet — those are layered on separately via userRoleService.getRolesForUser, exactly as UserService's
// real findOne does).
const buildUserRow = (id: number): User =>
  ({
    id,
    firstName: 'Test',
    lastName: `User${id}`,
    email: `user${id}@example.com`,
  }) as User;

describe('UserService — role assignment endpoints (real UserRoleService over an in-memory user_roles table)', () => {
  interface Row {
    id: number;
    userId: number;
    roleId: number;
  }

  let service: UserService;
  let usersRepo: { findOne: jest.Mock };
  let roleService: { findOne: jest.Mock };
  let auditService: { record: jest.Mock };
  let table: Row[];
  let inserted: number[];
  let deleted: number[];

  // Users: 5 holds SUPER_ADMIN then ADMIN; 6 holds SUPER_ADMIN only; 7 holds OPERATIONS then FINANCE;
  // 8 holds OPERATIONS only. User 99 does not exist.
  const INITIAL_ROWS: Row[] = [
    { id: 11, userId: 5, roleId: SUPER_ADMIN_ROLE.id },
    { id: 12, userId: 5, roleId: ADMIN_ROLE.id },
    { id: 21, userId: 6, roleId: SUPER_ADMIN_ROLE.id },
    { id: 31, userId: 7, roleId: OPERATIONS_ROLE.id },
    { id: 32, userId: 7, roleId: FINANCE_ROLE.id },
    { id: 41, userId: 8, roleId: OPERATIONS_ROLE.id },
  ];
  const EXISTING_USER_IDS = [5, 6, 7, 8];

  const rolesOf = (userId: number) =>
    table
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.id - b.id)
      .map((r) => r.roleId);

  beforeEach(async () => {
    table = INITIAL_ROWS.map((r) => ({ ...r }));
    let nextId = 100;
    inserted = [];
    deleted = [];
    const byId = (a: Row, b: Row) => a.id - b.id;

    // A locking read sees the latest committed rows, so it reads the live table.
    const lockQuery = () => {
      let params: { userId?: number; roleId?: number } = {};
      const qb: any = {
        setLock: () => qb,
        where: (_sql: string, p: typeof params) => {
          params = p;
          return qb;
        },
        orderBy: () => qb,
        getMany: async () =>
          table
            .filter((r) => (params.userId !== undefined ? r.userId === params.userId : r.roleId === params.roleId))
            .sort(byId)
            .map((r) => ({ ...r })),
      };
      return qb;
    };
    const txUserRoles = {
      find: async ({ where }: { where: { userId: number } }) => table.filter((r) => r.userId === where.userId).sort(byId).map((r) => ({ ...r })),
      create: (data: Partial<Row>) => data,
      save: async (data: Row) => {
        table.push({ ...data, id: nextId++ });
        inserted.push(data.roleId);
        return data;
      },
      delete: async (criteria: { userId: number; roleId: number }) => {
        table = table.filter((r) => !(r.userId === criteria.userId && r.roleId === criteria.roleId));
        deleted.push(criteria.roleId);
      },
      createQueryBuilder: () => lockQuery(),
    };
    const txRoles = { findOne: async ({ where }: { where: { id: number } }) => ROLE_TABLE.find((r) => r.id === where.id) ?? null };
    const txManager = {
      getRepository: (entity: unknown) => (entity === UserRole ? txUserRoles : entity === Role ? txRoles : undefined),
    };
    const userRolesRepo = {
      manager: {
        // commit when the callback resolves, roll back when it throws
        transaction: async (work: (m: unknown) => Promise<unknown>) => {
          const before = table.map((r) => ({ ...r }));
          try {
            return await work(txManager);
          } catch (err) {
            table = before;
            throw err;
          }
        },
      },
      // UserRoleService.getRolesForUser — the Role entities, in assignment order.
      find: async ({ where }: { where: { userId: number } }) =>
        table
          .filter((r) => r.userId === where.userId)
          .sort(byId)
          .map((r) => ({ ...r, role: ROLE_TABLE.find((role) => role.id === r.roleId) })),
    };

    usersRepo = {
      findOne: jest.fn(async ({ where }: { where: { id: number } }) => (EXISTING_USER_IDS.includes(where.id) ? buildUserRow(where.id) : null)),
    };
    roleService = {
      findOne: jest.fn(async (id: number) => {
        const role = ROLE_TABLE.find((r) => r.id === id);
        if (!role) throw new NotFoundException('Role not found');
        return role;
      }),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        UserRoleService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRolesRepo },
        { provide: RoleService, useValue: roleService },
        { provide: RolePermissionsService, useValue: { getUserPermissions: jest.fn() } },
        { provide: AttributeService, useValue: { isMandatory: jest.fn().mockResolvedValue(false) } },
        { provide: LovService, useValue: { findActiveLanguages: jest.fn().mockResolvedValue([]) } },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(UserService);
  });

  describe('addRoles', () => {
    it("adds the roles the user is missing and returns the user's full roles array AFTER the change, in assignment order", async () => {
      const result = await service.addRoles(8, [FINANCE_ROLE.id, ADMIN_ROLE.id], 99);

      expect(inserted).toEqual([FINANCE_ROLE.id, ADMIN_ROLE.id]);
      expect(result).toEqual([OPERATIONS_ROLE, FINANCE_ROLE, ADMIN_ROLE]);
      expect(rolesOf(8)).toEqual([OPERATIONS_ROLE.id, FINANCE_ROLE.id, ADMIN_ROLE.id]);
    });

    it('records ONE ASSIGN_ROLE audit row for the call, naming the real actor and the old and new role-id lists', async () => {
      await service.addRoles(8, [FINANCE_ROLE.id, ADMIN_ROLE.id], 99);

      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(
        {
          moduleName: 'user_roles',
          entityId: 8,
          action: 'ASSIGN_ROLE',
          oldValue: { roleIds: [OPERATIONS_ROLE.id] },
          newValue: { roleIds: [OPERATIONS_ROLE.id, FINANCE_ROLE.id, ADMIN_ROLE.id] },
          performedBy: 99,
        },
        expect.anything(),
      );
    });

    it('skips roles the user already holds — not an error, nothing inserted, no audit row, the same roles come back', async () => {
      const result = await service.addRoles(7, [OPERATIONS_ROLE.id, FINANCE_ROLE.id], 99);

      expect(inserted).toEqual([]);
      expect(auditService.record).not.toHaveBeenCalled();
      expect(result).toEqual([OPERATIONS_ROLE, FINANCE_ROLE]);
    });

    it('only inserts what is missing when the request mixes held and new roles', async () => {
      const result = await service.addRoles(7, [OPERATIONS_ROLE.id, ADMIN_ROLE.id], 99);

      expect(inserted).toEqual([ADMIN_ROLE.id]);
      expect(result).toEqual([OPERATIONS_ROLE, FINANCE_ROLE, ADMIN_ROLE]);
    });

    it('an unknown role id is a 404 and nothing is added — even when the other ids in the request are valid', async () => {
      await expect(service.addRoles(8, [FINANCE_ROLE.id, 4040], 99)).rejects.toThrow(NotFoundException);
      await expect(service.addRoles(8, [FINANCE_ROLE.id, 4040], 99)).rejects.toThrow('Role not found');

      expect(inserted).toEqual([]);
      expect(rolesOf(8)).toEqual([OPERATIONS_ROLE.id]);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('an unknown user is a 404 and nothing is written', async () => {
      await expect(service.addRoles(99, [FINANCE_ROLE.id], 5)).rejects.toThrow(NotFoundException);
      await expect(service.addRoles(99, [FINANCE_ROLE.id], 5)).rejects.toThrow('User not found');

      expect(inserted).toEqual([]);
    });

    it("blocks the actor from adding a role to their OWN user — self-escalation needs a second party (403, nothing written)", async () => {
      await expect(service.addRoles(5, [OPERATIONS_ROLE.id], 5)).rejects.toThrow(ForbiddenException);
      await expect(service.addRoles(5, [OPERATIONS_ROLE.id], 5)).rejects.toThrow('You cannot change your own roles.');

      expect(inserted).toEqual([]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('does NOT block the actor on their own user when the request would change nothing (only roles they already hold)', async () => {
      const result = await service.addRoles(5, [SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id], 5);

      expect(result).toEqual([SUPER_ADMIN_ROLE, ADMIN_ROLE]);
      expect(inserted).toEqual([]);
    });

    it("allows an actor to add roles to a DIFFERENT user's account, whatever role is added", async () => {
      await expect(service.addRoles(8, [SUPER_ADMIN_ROLE.id], 5)).resolves.toEqual([OPERATIONS_ROLE, SUPER_ADMIN_ROLE]);
    });
  });

  describe('removeRole', () => {
    it('blocks the actor from removing a role from their OWN user (403, nothing deleted)', async () => {
      await expect(service.removeRole(5, ADMIN_ROLE.id, 5)).rejects.toThrow(ForbiddenException);
      await expect(service.removeRole(5, ADMIN_ROLE.id, 5)).rejects.toThrow('You cannot change your own roles.');

      expect(deleted).toEqual([]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it("blocks removing a user's only remaining role — login rejects a role-less user, so it would be an instant lock-out (403, nothing deleted)", async () => {
      await expect(service.removeRole(8, OPERATIONS_ROLE.id, 5)).rejects.toThrow(ForbiddenException);
      await expect(service.removeRole(8, OPERATIONS_ROLE.id, 5)).rejects.toThrow('A user must hold at least one role.');

      expect(deleted).toEqual([]);
      expect(rolesOf(8)).toEqual([OPERATIONS_ROLE.id]);
    });

    it('blocks removing SUPER_ADMIN from the only user who holds it, even though that user has another role (403, nothing deleted)', async () => {
      // User 6 loses their SUPER_ADMIN row first — user 5 becomes the sole holder.
      table = table.filter((r) => r.id !== 21);

      await expect(service.removeRole(5, SUPER_ADMIN_ROLE.id, 99)).rejects.toThrow(ForbiddenException);
      await expect(service.removeRole(5, SUPER_ADMIN_ROLE.id, 99)).rejects.toThrow(
        'Cannot remove the last SUPER_ADMIN — at least one user must hold this role.',
      );

      expect(deleted).toEqual([]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
    });

    it('allows removing SUPER_ADMIN from a user when at least one OTHER user also holds it, and returns the roles after the change', async () => {
      const result = await service.removeRole(5, SUPER_ADMIN_ROLE.id, 99);

      expect(deleted).toEqual([SUPER_ADMIN_ROLE.id]);
      expect(result).toEqual([ADMIN_ROLE]);
      expect(rolesOf(6)).toEqual([SUPER_ADMIN_ROLE.id]);
    });

    it('allows removing a non-SUPER_ADMIN role from a user who holds two or more roles, and records ONE REVOKE_ROLE audit row', async () => {
      const result = await service.removeRole(7, FINANCE_ROLE.id, 99);

      expect(result).toEqual([OPERATIONS_ROLE]);
      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(
        {
          moduleName: 'user_roles',
          entityId: 7,
          action: 'REVOKE_ROLE',
          oldValue: { roleIds: [OPERATIONS_ROLE.id, FINANCE_ROLE.id] },
          newValue: { roleIds: [OPERATIONS_ROLE.id] },
          performedBy: 99,
        },
        expect.anything(),
      );
    });

    it('removing a role the user does not hold is an idempotent no-op — nothing deleted, no audit row, the current roles come back', async () => {
      const result = await service.removeRole(7, ADMIN_ROLE.id, 99);

      expect(deleted).toEqual([]);
      expect(auditService.record).not.toHaveBeenCalled();
      expect(result).toEqual([OPERATIONS_ROLE, FINANCE_ROLE]);
    });

    it("a self no-op (removing a role you do not hold from your own user) is allowed, not blocked as a self-change", async () => {
      await expect(service.removeRole(7, ADMIN_ROLE.id, 7)).resolves.toEqual([OPERATIONS_ROLE, FINANCE_ROLE]);
    });

    it('an unknown user is a 404 and nothing is deleted', async () => {
      await expect(service.removeRole(99, FINANCE_ROLE.id, 5)).rejects.toThrow(NotFoundException);

      expect(deleted).toEqual([]);
    });

    it('a role removed through here can be added again (hard delete leaves the unique (user, role) key free)', async () => {
      await service.removeRole(7, FINANCE_ROLE.id, 99);
      const result = await service.addRoles(7, [FINANCE_ROLE.id], 99);

      expect(result).toEqual([OPERATIONS_ROLE, FINANCE_ROLE]);
    });
  });
});

describe('UserService', () => {
  let service: UserService;
  let usersRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock; manager: { transaction: jest.Mock } };
  let txUsersRepo: { save: jest.Mock };
  let txManager: { getRepository: jest.Mock };
  let roleService: { findOne: jest.Mock; findByName: jest.Mock };
  let rolePermissionsService: { getUserPermissions: jest.Mock };
  let attributeService: { isMandatory: jest.Mock };
  let lovService: { findActiveLanguages: jest.Mock };
  let userRoleService: {
    getRolesForUser: jest.Mock;
    getRolesForUsers: jest.Mock;
    getUsersByRoleCapability: jest.Mock;
    addRolesToUser: jest.Mock;
    removeRoleFromUser: jest.Mock;
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    txUsersRepo = { save: jest.fn().mockImplementation((u) => Promise.resolve(Object.assign(u, { id: 77 }))) };
    txManager = { getRepository: jest.fn().mockReturnValue(txUsersRepo) };
    usersRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((u) => Promise.resolve(u)),
      manager: { transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(txManager)) },
    };
    roleService = { findOne: jest.fn().mockImplementation(async (id: number) => ROLE_TABLE.find((r) => r.id === id) ?? Promise.reject(new NotFoundException('Role not found'))), findByName: jest.fn() };
    rolePermissionsService = { getUserPermissions: jest.fn().mockResolvedValue([]) };
    attributeService = { isMandatory: jest.fn().mockResolvedValue(false) };
    lovService = { findActiveLanguages: jest.fn().mockResolvedValue([]) };
    userRoleService = {
      getRolesForUser: jest.fn().mockResolvedValue([]),
      getRolesForUsers: jest.fn().mockResolvedValue(new Map()),
      getUsersByRoleCapability: jest.fn().mockResolvedValue([]),
      addRolesToUser: jest.fn().mockResolvedValue([]),
      removeRoleFromUser: jest.fn().mockResolvedValue(false),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: RoleService, useValue: roleService },
        { provide: RolePermissionsService, useValue: rolePermissionsService },
        { provide: AttributeService, useValue: attributeService },
        { provide: LovService, useValue: lovService },
        { provide: UserRoleService, useValue: userRoleService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(UserService);
  });

  describe('create — several roles', () => {
    const dto = {
      roleIds: [OPERATIONS_ROLE.id, FINANCE_ROLE.id, ADMIN_ROLE.id],
      firstName: 'New',
      lastName: 'Hire',
      email: 'new.hire@example.com',
    } as any;

    beforeEach(() => {
      usersRepo.findOne.mockResolvedValue(null); // email/mobile/employee-code uniqueness lookups find nothing
    });

    it('creates the user and assigns EVERY role in dto.roleIds, in order, inside the same transaction as the user row and the audit row', async () => {
      const saved = await service.create(dto, 9);

      expect(saved.id).toBe(77);
      expect(usersRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(txUsersRepo.save).toHaveBeenCalledTimes(1);
      expect(userRoleService.addRolesToUser).toHaveBeenCalledWith(
        77,
        [OPERATIONS_ROLE.id, FINANCE_ROLE.id, ADMIN_ROLE.id],
        txManager,
        9,
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ moduleName: 'users', entityId: 77, action: 'CREATE', performedBy: 9 }),
        txManager,
      );
    });

    it('validates that every role exists BEFORE anything is written — one unknown id is a 404 and no user is created', async () => {
      await expect(service.create({ ...dto, roleIds: [OPERATIONS_ROLE.id, 4040] }, 9)).rejects.toThrow(NotFoundException);

      expect(usersRepo.manager.transaction).not.toHaveBeenCalled();
      expect(txUsersRepo.save).not.toHaveBeenCalled();
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
    });

    it('checks each distinct role id once', async () => {
      await service.create({ ...dto, roleIds: [FINANCE_ROLE.id, OPERATIONS_ROLE.id] }, 9);

      expect(roleService.findOne).toHaveBeenCalledTimes(2);
      expect(roleService.findOne).toHaveBeenCalledWith(FINANCE_ROLE.id);
      expect(roleService.findOne).toHaveBeenCalledWith(OPERATIONS_ROLE.id);
    });

    it('a failure while assigning roles rolls the whole creation back — the error propagates out of the one transaction', async () => {
      userRoleService.addRolesToUser.mockRejectedValue(new Error('constraint'));

      await expect(service.create(dto, 9)).rejects.toThrow('constraint');

      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('update — never touches roles', () => {
    it('saves the profile change and calls NO user-role write method, even when handed a stale role field', async () => {
      usersRepo.findOne.mockResolvedValue(buildUserRow(5));
      userRoleService.getRolesForUser.mockResolvedValue([SUPER_ADMIN_ROLE]);

      // The global ValidationPipe rejects these with a 400 before they get here; this proves nothing
      // downstream would act on one anyway.
      await expect(
        service.update(5, { firstName: 'Renamed', roleId: ADMIN_ROLE.id, roleIds: [ADMIN_ROLE.id] } as any, 5),
      ).resolves.toBeDefined();

      expect(usersRepo.save).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Renamed' }));
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
      expect(userRoleService.removeRoleFromUser).not.toHaveBeenCalled();
      expect(roleService.findOne).not.toHaveBeenCalled();
      expect(roleService.findByName).not.toHaveBeenCalled();
    });

    it('a user can still edit their own profile — the old self-role-change refusal is gone from update (it now lives in addRoles/removeRole)', async () => {
      usersRepo.findOne.mockResolvedValue(buildUserRow(5));
      userRoleService.getRolesForUser.mockResolvedValue([ADMIN_ROLE]);

      await expect(service.update(5, { firstName: 'Me' } as any, 5)).resolves.toBeDefined();
      expect(usersRepo.save).toHaveBeenCalled();
    });
  });

  describe('findOne — role (primary) and roles (all)', () => {
    it('attaches `role` (the primary, first assigned) and `roles` (every role, same order) from ONE roles read', async () => {
      usersRepo.findOne.mockResolvedValue(buildUserRow(5));
      userRoleService.getRolesForUser.mockResolvedValue([OPERATIONS_ROLE, SUPER_ADMIN_ROLE]);

      const user = await service.findOne(5);

      expect(user.role).toBe(OPERATIONS_ROLE);
      expect(user.roles).toEqual([OPERATIONS_ROLE, SUPER_ADMIN_ROLE]);
      expect(user.roles[0]).toBe(user.role);
      expect(userRoleService.getRolesForUser).toHaveBeenCalledTimes(1);
      expect(userRoleService.getRolesForUser).toHaveBeenCalledWith(5);
    });

    it('a user with no roles gets role: null and roles: []', async () => {
      usersRepo.findOne.mockResolvedValue(buildUserRow(5));
      userRoleService.getRolesForUser.mockResolvedValue([]);

      const user = await service.findOne(5);

      expect(user.role).toBeNull();
      expect(user.roles).toEqual([]);
    });

    it('is a 404 for an unknown user, without reading any roles', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(5)).rejects.toThrow(NotFoundException);
      expect(userRoleService.getRolesForUser).not.toHaveBeenCalled();
    });
  });

  describe('getProfile — role (primary) and roles (all)', () => {
    const profileUser = () => ({
      ...buildUserRow(5),
      middleName: 'M',
      employeeCode: 'EMP5',
      designation: 'Analyst',
      themeMode: 'dark',
      navTheme: undefined,
      preferredLanguageCode: 'en',
    });

    it('keeps `role: { id, name }` as the primary and adds `roles` — every role as { id, name }, in assignment order — with every existing field intact', async () => {
      usersRepo.findOne.mockResolvedValue(profileUser());
      userRoleService.getRolesForUser.mockResolvedValue([OPERATIONS_ROLE, SUPER_ADMIN_ROLE]);
      rolePermissionsService.getUserPermissions.mockResolvedValue([{ moduleName: 'Users' }]);

      const profile = await service.getProfile(5);

      expect(profile).toEqual({
        id: 5,
        firstName: 'Test',
        middleName: 'M',
        lastName: 'User5',
        email: 'user5@example.com',
        employeeCode: 'EMP5',
        designation: 'Analyst',
        role: { id: OPERATIONS_ROLE.id, name: ROLES.OPERATIONS },
        roles: [
          { id: OPERATIONS_ROLE.id, name: ROLES.OPERATIONS },
          { id: SUPER_ADMIN_ROLE.id, name: ROLES.SUPER_ADMIN },
        ],
        themeMode: 'dark',
        navTheme: null,
        preferredLanguageCode: 'en',
        permissions: [{ moduleName: 'Users' }],
      });
      expect(rolePermissionsService.getUserPermissions).toHaveBeenCalledWith(OPERATIONS_ROLE.id);
    });

    it('is a 404 for a user with no role at all', async () => {
      usersRepo.findOne.mockResolvedValue(profileUser());
      userRoleService.getRolesForUser.mockResolvedValue([]);

      await expect(service.getProfile(5)).rejects.toThrow('No role assigned to this user');
    });
  });

  describe('getReportingManagers / getFieldInspectors — one deterministic entry per user', () => {
    // user 4 holds two qualifying roles (assigned FINANCE first, then OPERATIONS); user 9 holds one.
    // Rows come back in assignment order (user_roles.id ASC).
    const GRANTS = [
      { userId: 4, roleId: FINANCE_ROLE.id, roleName: ROLES.FINANCE },
      { userId: 9, roleId: ADMIN_ROLE.id, roleName: ROLES.ADMIN },
      { userId: 4, roleId: OPERATIONS_ROLE.id, roleName: ROLES.OPERATIONS },
    ];
    const userRow = (id: number) => ({ id, firstName: `U${id}`, lastName: 'L', employeeCode: `E${id}` });

    beforeEach(() => {
      userRoleService.getUsersByRoleCapability.mockResolvedValue(GRANTS);
      usersRepo.find.mockResolvedValue([userRow(4), userRow(9)]);
    });

    it("lists a multi-role user once, under their FIRST-assigned qualifying role's name", async () => {
      const managers = await service.getReportingManagers();

      expect(managers).toEqual([
        { id: 4, firstName: 'U4', lastName: 'L', employeeCode: 'E4', roleName: ROLES.FINANCE },
        { id: 9, firstName: 'U9', lastName: 'L', employeeCode: 'E9', roleName: ROLES.ADMIN },
      ]);
      expect(userRoleService.getUsersByRoleCapability).toHaveBeenCalledWith('canBeReportingManager');
    });

    it('asks for each user id once, and only active users', async () => {
      await service.getFieldInspectors();

      expect(userRoleService.getUsersByRoleCapability).toHaveBeenCalledWith('canBeFieldInspector');
      expect(usersRepo.find).toHaveBeenCalledWith({
        where: { id: In([4, 9]), active: true },
        order: { firstName: 'ASC' },
      });
    });

    it('does not query users at all when nobody qualifies', async () => {
      userRoleService.getUsersByRoleCapability.mockResolvedValue([]);

      await expect(service.getReportingManagers()).resolves.toEqual([]);
      expect(usersRepo.find).not.toHaveBeenCalled();
    });
  });
});
