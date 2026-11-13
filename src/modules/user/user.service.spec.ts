import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
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
import { AssignmentBoundaryService } from '../iam/assignment-boundary.service';
import { UserInlinePolicy } from '../iam/entities/user-inline-policy.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { AuditService } from '../../audit/audit.service';
import { ROLES } from '../../common/constants/global';
import { Actor, SUPER_ADMIN_ASSIGN_MESSAGE, SUPER_ADMIN_MODIFY_MESSAGE, SYSTEM_ACTOR, initialSuperAdminProtectedMessage } from '../../common/security/actor';

// Isolated tests for UserService — every dependency mocked or replaced by an in-memory stand-in, no real
// database connection. Follows the same mocking conventions as iam.service.spec.ts (plain jest.fn() mocks
// per repo/service, wired via Test.createTestingModule + getRepositoryToken).
//
// Two setups on purpose. The first puts UserService on top of the REAL UserRoleService, over an in-memory
// database (users, user_roles, roles, sessions): the protection rules — only a SUPER_ADMIN may grant or
// touch SUPER_ADMIN, nobody deletes or deactivates themselves, the last ACTIVE SUPER_ADMIN is untouchable,
// no self role-change, a user keeps one role — live in these services' transactions, so asserting them
// against a mocked UserRoleService would only prove the mock. The second uses a plain mocked UserRoleService
// like every other service spec here, for everything that is not a protection rule (findOne, getProfile,
// the pickers, findAuthState, what create/update hand to their collaborators).

// SUPER_ADMIN is the ONLY predefined role (the ROLES constant). Every other role is created dynamically, so these
// ordinary roles are plain test fixtures local to this spec: nothing in UserService depends on what they are called.
const ORDINARY_ROLE_NAMES = { ADMIN: 'ADMIN', OPERATIONS: 'OPERATIONS', FINANCE: 'FINANCE' } as const;

const SUPER_ADMIN_ROLE = { id: 1, roleName: ROLES.SUPER_ADMIN };
const ADMIN_ROLE = { id: 2, roleName: ORDINARY_ROLE_NAMES.ADMIN };
const OPERATIONS_ROLE = { id: 3, roleName: ORDINARY_ROLE_NAMES.OPERATIONS };
const FINANCE_ROLE = { id: 4, roleName: ORDINARY_ROLE_NAMES.FINANCE };
const ROLE_TABLE = [SUPER_ADMIN_ROLE, ADMIN_ROLE, OPERATIONS_ROLE, FINANCE_ROLE];

// Who is acting. The rules are decided from the actor's CURRENT role names (what JwtStrategy re-reads on
// every request) — `superAdmin(id)` may do everything; `staff(id)` has EDIT_USER / CREATE_USER / DELETE_USER
// style authority only, which must never be enough to touch the accounts that sit above it.
const superAdmin = (id: number): Actor => ({ kind: 'user', id, roleNames: [ROLES.SUPER_ADMIN] });
const staff = (id: number): Actor => ({ kind: 'user', id, roleNames: ['USER_MANAGER'] });
const ROOT = superAdmin(99);
const STAFF = staff(50);

// Builds the raw User row findOne's own `this.users.findOne` would return (no `role`/`roles` attached
// yet — those are layered on separately via userRoleService.getRolesForUser, exactly as UserService's
// real findOne does).
const buildUserRow = (id: number, extra: Partial<User> = {}): User =>
  ({
    id,
    firstName: 'Test',
    lastName: `User${id}`,
    email: `user${id}@example.com`,
    active: true,
    ...extra,
  }) as User;

describe('UserService — protections enforced end to end (real UserRoleService over an in-memory database)', () => {
  interface Row {
    id: number;
    userId: number;
    roleId: number;
  }
  interface UserState {
    active: boolean;
    deletedAt: Date | null;
  }

  let service: UserService;
  let usersRepo: { findOne: jest.Mock; manager: { transaction: jest.Mock } };
  let roleService: { findOne: jest.Mock };
  let auditService: { record: jest.Mock };
  let table: Row[];
  let userStates: Record<number, UserState>;
  let inserted: number[];
  let deleted: number[];
  let deletedAllRolesFor: number[];
  let softRemoved: number[];
  let savedUsers: any[];
  let inlinePolicyDeletes: Array<Record<string, unknown>>;
  let sessionRevocations: Array<{ entity: unknown; values: unknown; params: unknown }>;
  let transactions: number;

  // Users: 5 holds SUPER_ADMIN then ADMIN; 6 holds SUPER_ADMIN only; 7 holds OPERATIONS then FINANCE;
  // 8 holds OPERATIONS only. All four are active. User 99 does not exist.
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

  const LAST_ACTIVE = (action: string) => `Cannot ${action} the last active SUPER_ADMIN — at least one active user must hold this role.`;

  beforeEach(async () => {
    table = INITIAL_ROWS.map((r) => ({ ...r }));
    userStates = Object.fromEntries(EXISTING_USER_IDS.map((id) => [id, { active: true, deletedAt: null }]));
    let nextId = 100;
    let nextUserId = 200;
    inserted = [];
    deleted = [];
    deletedAllRolesFor = [];
    softRemoved = [];
    savedUsers = [];
    inlinePolicyDeletes = [];
    sessionRevocations = [];
    transactions = 0;
    const byId = (a: Row, b: Row) => a.id - b.id;
    const isLive = (userId: number) => !!userStates[userId] && userStates[userId].active && userStates[userId].deletedAt === null;

    // A locking read sees the latest committed rows, so it reads the live table. A join that restricts to
    // active, non-deleted users (the SUPER_ADMIN-holder lock) is honoured against the users' state.
    const lockQuery = () => {
      let params: { userId?: number; roleId?: number } = {};
      let liveUsersOnly = false;
      const qb: any = {
        setLock: () => qb,
        innerJoin: (_relation: string, _alias: string, condition: string) => {
          liveUsersOnly = /user\.active/.test(condition) && /user\.deletedAt IS NULL/.test(condition);
          return qb;
        },
        where: (_sql: string, p: typeof params) => {
          params = p;
          return qb;
        },
        orderBy: () => qb,
        getMany: async () =>
          table
            .filter((r) => (params.userId !== undefined ? r.userId === params.userId : r.roleId === params.roleId))
            .filter((r) => !liveUsersOnly || isLive(r.userId))
            .sort(byId)
            .map((r) => ({ ...r })),
      };
      return qb;
    };
    const txUserRoles = {
      find: async ({ where, relations }: { where: { userId: number }; relations?: { role?: boolean } }) =>
        table
          .filter((r) => r.userId === where.userId)
          .sort(byId)
          .map((r) => ({ ...r, ...(relations?.role ? { role: ROLE_TABLE.find((role) => role.id === r.roleId) } : {}) })),
      create: (data: Partial<Row>) => data,
      save: async (data: Row) => {
        table.push({ ...data, id: nextId++ });
        inserted.push(data.roleId);
        return data;
      },
      delete: async (criteria: { userId: number; roleId?: number }) => {
        table = table.filter((r) => !(r.userId === criteria.userId && (criteria.roleId === undefined || r.roleId === criteria.roleId)));
        if (criteria.roleId === undefined) deletedAllRolesFor.push(criteria.userId);
        else deleted.push(criteria.roleId);
      },
      createQueryBuilder: () => lockQuery(),
    };
    const txRoles = {
      findOne: async ({ where }: { where: { id?: number; roleName?: string } }) =>
        ROLE_TABLE.find((r) => (where.id !== undefined ? r.id === where.id : r.roleName === where.roleName)) ?? null,
      find: async ({ where }: { where: { id: { value: number[] } } }) => ROLE_TABLE.filter((r) => where.id.value.includes(r.id)),
    };
    const txUsers = {
      save: async (user: any) => {
        const saved = Object.assign(user, { id: user.id ?? nextUserId++ });
        userStates[saved.id] = { active: saved.active ?? true, deletedAt: null };
        savedUsers.push(saved);
        return saved;
      },
      softRemove: async (user: any) => {
        softRemoved.push(user.id);
        userStates[user.id] = { ...userStates[user.id], deletedAt: new Date() };
        return user;
      },
    };
    const txInlinePolicies = {
      delete: async (criteria: Record<string, unknown>) => {
        inlinePolicyDeletes.push(criteria);
      },
    };
    // manager.createQueryBuilder() serves both the soft-deleted-unique release and the session revocation.
    const writeQuery = () => {
      const captured: { entity?: unknown; values?: unknown; params?: unknown } = {};
      const qb: any = {
        update: (entity: unknown) => {
          captured.entity = entity;
          return qb;
        },
        set: (values: unknown) => {
          captured.values = values;
          return qb;
        },
        where: (_sql: string, params?: unknown) => {
          captured.params = params;
          return qb;
        },
        andWhere: () => qb,
        execute: async () => {
          if (captured.entity === RefreshToken) sessionRevocations.push(captured as never);
          return { affected: 0 };
        },
      };
      return qb;
    };
    const txManager = {
      getRepository: (entity: unknown) =>
        entity === UserRole
          ? txUserRoles
          : entity === Role
            ? txRoles
            : entity === User
              ? txUsers
              : entity === UserInlinePolicy
                ? txInlinePolicies
                : undefined,
      createQueryBuilder: () => writeQuery(),
      connection: {
        getMetadata: () => ({
          name: 'User',
          findColumnWithPropertyName: (property: string) => ({ databaseName: property }),
          deleteDateColumn: { databaseName: 'deleted_at' },
        }),
      },
    };
    // commit when the callback resolves, roll back when it throws
    const transaction = async (work: (m: unknown) => Promise<unknown>) => {
      transactions += 1;
      const before = { table: table.map((r) => ({ ...r })), userStates: JSON.parse(JSON.stringify(userStates)) };
      try {
        return await work(txManager);
      } catch (err) {
        table = before.table;
        userStates = before.userStates;
        throw err;
      }
    };
    const userRolesRepo = {
      manager: { transaction, getRepository: txManager.getRepository },
      // UserRoleService.getRolesForUser — the Role entities, in assignment order.
      find: async ({ where }: { where: { userId: number } }) =>
        table
          .filter((r) => r.userId === where.userId)
          .sort(byId)
          .map((r) => ({ ...r, role: ROLE_TABLE.find((role) => role.id === r.roleId) })),
    };

    usersRepo = {
      findOne: jest.fn(async ({ where }: { where: { id?: number } }) =>
        where.id !== undefined && EXISTING_USER_IDS.includes(where.id) && userStates[where.id]?.deletedAt === null
          ? buildUserRow(where.id, { active: userStates[where.id].active })
          : null,
      ),
      manager: { transaction: jest.fn(transaction) },
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
        // The assignment boundary (what a delegated administrator may hand out) has its own spec; here every role fits inside the actor's
        // scope, so the rules under test are the SUPER_ADMIN / last-administrator / self-change protections alone.
        { provide: AssignmentBoundaryService, useValue: { assertWithinBoundary: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = moduleRef.get(UserService);
  });

  describe('addRoles', () => {
    it("adds the roles the user is missing and returns the user's full roles array AFTER the change, in assignment order", async () => {
      const result = await service.addRoles(8, [FINANCE_ROLE.id, ADMIN_ROLE.id], ROOT);

      expect(inserted).toEqual([FINANCE_ROLE.id, ADMIN_ROLE.id]);
      expect(result).toEqual([OPERATIONS_ROLE, FINANCE_ROLE, ADMIN_ROLE]);
      expect(rolesOf(8)).toEqual([OPERATIONS_ROLE.id, FINANCE_ROLE.id, ADMIN_ROLE.id]);
    });

    it('records ONE ASSIGN_ROLE audit row for the call, naming the real actor and the old and new role-id lists', async () => {
      await service.addRoles(8, [FINANCE_ROLE.id, ADMIN_ROLE.id], ROOT);

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
      const result = await service.addRoles(7, [OPERATIONS_ROLE.id, FINANCE_ROLE.id], ROOT);

      expect(inserted).toEqual([]);
      expect(auditService.record).not.toHaveBeenCalled();
      expect(result).toEqual([OPERATIONS_ROLE, FINANCE_ROLE]);
    });

    it('only inserts what is missing when the request mixes held and new roles', async () => {
      const result = await service.addRoles(7, [OPERATIONS_ROLE.id, ADMIN_ROLE.id], ROOT);

      expect(inserted).toEqual([ADMIN_ROLE.id]);
      expect(result).toEqual([OPERATIONS_ROLE, FINANCE_ROLE, ADMIN_ROLE]);
    });

    it('an unknown role id is a 404 and nothing is added — even when the other ids in the request are valid', async () => {
      await expect(service.addRoles(8, [FINANCE_ROLE.id, 4040], ROOT)).rejects.toThrow(NotFoundException);
      await expect(service.addRoles(8, [FINANCE_ROLE.id, 4040], ROOT)).rejects.toThrow('Role not found');

      expect(inserted).toEqual([]);
      expect(rolesOf(8)).toEqual([OPERATIONS_ROLE.id]);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('an unknown user is a 404 and nothing is written', async () => {
      await expect(service.addRoles(99, [FINANCE_ROLE.id], superAdmin(5))).rejects.toThrow(NotFoundException);
      await expect(service.addRoles(99, [FINANCE_ROLE.id], superAdmin(5))).rejects.toThrow('User not found');

      expect(inserted).toEqual([]);
    });

    it('blocks the actor from adding a role to their OWN user — self-escalation needs a second party (403, nothing written)', async () => {
      await expect(service.addRoles(5, [OPERATIONS_ROLE.id], superAdmin(5))).rejects.toThrow(ForbiddenException);
      await expect(service.addRoles(5, [OPERATIONS_ROLE.id], superAdmin(5))).rejects.toThrow('You cannot change your own roles.');

      expect(inserted).toEqual([]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('does NOT block the actor on their own user when the request would change nothing (only roles they already hold)', async () => {
      const result = await service.addRoles(5, [SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id], superAdmin(5));

      expect(result).toEqual([SUPER_ADMIN_ROLE, ADMIN_ROLE]);
      expect(inserted).toEqual([]);
    });

    it("allows a SUPER_ADMIN to add roles to a DIFFERENT user's account, whatever role is added — SUPER_ADMIN included", async () => {
      await expect(service.addRoles(8, [SUPER_ADMIN_ROLE.id], superAdmin(5))).resolves.toEqual([OPERATIONS_ROLE, SUPER_ADMIN_ROLE]);
    });

    describe('SUPER_ADMIN assignment is reserved to a SUPER_ADMIN (EDIT_USER carries no such authority)', () => {
      it('a non-SUPER_ADMIN actor is refused with 403 and the SUPER_ADMIN message — nothing written, nothing audited', async () => {
        await expect(service.addRoles(8, [SUPER_ADMIN_ROLE.id], STAFF)).rejects.toThrow(ForbiddenException);
        await expect(service.addRoles(8, [SUPER_ADMIN_ROLE.id], STAFF)).rejects.toThrow(SUPER_ADMIN_ASSIGN_MESSAGE);

        expect(inserted).toEqual([]);
        expect(rolesOf(8)).toEqual([OPERATIONS_ROLE.id]);
        expect(auditService.record).not.toHaveBeenCalled();
        expect(transactions).toBe(0); // refused before the write transaction was even opened
      });

      it('...whatever else is in the request: SUPER_ADMIN smuggled in among ordinary roles refuses the whole call', async () => {
        await expect(service.addRoles(8, [FINANCE_ROLE.id, SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id], STAFF)).rejects.toThrow(
          SUPER_ADMIN_ASSIGN_MESSAGE,
        );

        expect(rolesOf(8)).toEqual([OPERATIONS_ROLE.id]);
      });

      it('a non-SUPER_ADMIN actor can still grant every ordinary role — ADMIN included, only SUPER_ADMIN is reserved', async () => {
        await expect(service.addRoles(8, [FINANCE_ROLE.id, ADMIN_ROLE.id], STAFF)).resolves.toEqual([
          OPERATIONS_ROLE,
          FINANCE_ROLE,
          ADMIN_ROLE,
        ]);
      });

      it('an unknown role id is still reported as a 404 (not hidden behind the privilege check)', async () => {
        await expect(service.addRoles(8, [4040], STAFF)).rejects.toThrow(NotFoundException);
      });

      it("a non-SUPER_ADMIN actor cannot change the roles of a user who holds SUPER_ADMIN — even to add an ordinary role", async () => {
        await expect(service.addRoles(6, [FINANCE_ROLE.id], STAFF)).rejects.toThrow(ForbiddenException);
        await expect(service.addRoles(6, [FINANCE_ROLE.id], STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

        expect(rolesOf(6)).toEqual([SUPER_ADMIN_ROLE.id]);
      });

      it("a SUPER_ADMIN actor may change a SUPER_ADMIN user's roles", async () => {
        await expect(service.addRoles(6, [FINANCE_ROLE.id], ROOT)).resolves.toEqual([SUPER_ADMIN_ROLE, FINANCE_ROLE]);
      });

      it('the system actor (boot-time seeding) may grant SUPER_ADMIN', async () => {
        await expect(service.addRoles(8, [SUPER_ADMIN_ROLE.id], SYSTEM_ACTOR)).resolves.toEqual([OPERATIONS_ROLE, SUPER_ADMIN_ROLE]);
      });
    });
  });

  describe('removeRole', () => {
    it('blocks the actor from removing a role from their OWN user (403, nothing deleted)', async () => {
      await expect(service.removeRole(5, ADMIN_ROLE.id, superAdmin(5))).rejects.toThrow(ForbiddenException);
      await expect(service.removeRole(5, ADMIN_ROLE.id, superAdmin(5))).rejects.toThrow('You cannot change your own roles.');

      expect(deleted).toEqual([]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it("blocks removing a user's only remaining role — login rejects a role-less user, so it would be an instant lock-out (403, nothing deleted)", async () => {
      await expect(service.removeRole(8, OPERATIONS_ROLE.id, superAdmin(5))).rejects.toThrow(ForbiddenException);
      await expect(service.removeRole(8, OPERATIONS_ROLE.id, superAdmin(5))).rejects.toThrow('A user must hold at least one role.');

      expect(deleted).toEqual([]);
      expect(rolesOf(8)).toEqual([OPERATIONS_ROLE.id]);
    });

    it('blocks removing SUPER_ADMIN from the only user who holds it, even though that user has another role (403, nothing deleted)', async () => {
      // User 6 loses their SUPER_ADMIN row first — user 5 becomes the sole holder.
      table = table.filter((r) => r.id !== 21);

      await expect(service.removeRole(5, SUPER_ADMIN_ROLE.id, ROOT)).rejects.toThrow(ForbiddenException);
      await expect(service.removeRole(5, SUPER_ADMIN_ROLE.id, ROOT)).rejects.toThrow(
        'Cannot remove the last active SUPER_ADMIN — at least one active user must hold this role.',
      );

      expect(deleted).toEqual([]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
    });

    it('a DEACTIVATED second holder does not count — the active one is still the last SUPER_ADMIN and cannot be demoted', async () => {
      userStates[6] = { active: false, deletedAt: null };

      await expect(service.removeRole(5, SUPER_ADMIN_ROLE.id, ROOT)).rejects.toThrow(
        'Cannot remove the last active SUPER_ADMIN — at least one active user must hold this role.',
      );

      expect(deleted).toEqual([]);
    });

    it('refuses to demote the INITIAL SUPER_ADMIN (the oldest active holder, user 5) even while another active SUPER_ADMIN exists — the owner can never be removed by accident (403, nothing deleted)', async () => {
      await expect(service.removeRole(5, SUPER_ADMIN_ROLE.id, ROOT)).rejects.toThrow(ForbiddenException);
      await expect(service.removeRole(5, SUPER_ADMIN_ROLE.id, ROOT)).rejects.toThrow(initialSuperAdminProtectedMessage('demote'));

      expect(deleted).toEqual([]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('allows removing SUPER_ADMIN from a holder who is NOT the initial one when at least one OTHER active user also holds it, and returns the roles after the change', async () => {
      table.push({ id: 22, userId: 6, roleId: FINANCE_ROLE.id }); // user 6 keeps a second role, so losing SUPER_ADMIN leaves them one

      const result = await service.removeRole(6, SUPER_ADMIN_ROLE.id, ROOT);

      expect(deleted).toEqual([SUPER_ADMIN_ROLE.id]);
      expect(result).toEqual([FINANCE_ROLE]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
    });

    it('allows removing a non-SUPER_ADMIN role from a user who holds two or more roles, and records ONE REVOKE_ROLE audit row', async () => {
      const result = await service.removeRole(7, FINANCE_ROLE.id, ROOT);

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
      const result = await service.removeRole(7, ADMIN_ROLE.id, ROOT);

      expect(deleted).toEqual([]);
      expect(auditService.record).not.toHaveBeenCalled();
      expect(result).toEqual([OPERATIONS_ROLE, FINANCE_ROLE]);
    });

    it('a self no-op (removing a role you do not hold from your own user) is allowed, not blocked as a self-change', async () => {
      await expect(service.removeRole(7, ADMIN_ROLE.id, staff(7))).resolves.toEqual([OPERATIONS_ROLE, FINANCE_ROLE]);
    });

    it('an unknown user is a 404 and nothing is deleted', async () => {
      await expect(service.removeRole(99, FINANCE_ROLE.id, superAdmin(5))).rejects.toThrow(NotFoundException);

      expect(deleted).toEqual([]);
    });

    it('a role removed through here can be added again (hard delete leaves the unique (user, role) key free)', async () => {
      await service.removeRole(7, FINANCE_ROLE.id, ROOT);
      const result = await service.addRoles(7, [FINANCE_ROLE.id], ROOT);

      expect(result).toEqual([OPERATIONS_ROLE, FINANCE_ROLE]);
    });

    it("a non-SUPER_ADMIN actor cannot strip roles from a SUPER_ADMIN's account, nor SUPER_ADMIN itself (403, nothing deleted)", async () => {
      await expect(service.removeRole(5, ADMIN_ROLE.id, STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);
      await expect(service.removeRole(5, SUPER_ADMIN_ROLE.id, STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

      expect(deleted).toEqual([]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
    });

    it('a non-SUPER_ADMIN actor can revoke a role from an ordinary account', async () => {
      await expect(service.removeRole(7, FINANCE_ROLE.id, STAFF)).resolves.toEqual([OPERATIONS_ROLE]);
    });
  });

  describe('create', () => {
    const dto = (roleIds: number[]) =>
      ({ roleIds, firstName: 'New', lastName: 'Hire', email: 'new.hire@example.com' }) as any;

    it('a non-SUPER_ADMIN actor cannot create an account that holds SUPER_ADMIN — 403 before ANYTHING is written (no transaction, no user row, no role row)', async () => {
      await expect(service.create(dto([OPERATIONS_ROLE.id, SUPER_ADMIN_ROLE.id]), STAFF)).rejects.toThrow(ForbiddenException);
      await expect(service.create(dto([OPERATIONS_ROLE.id, SUPER_ADMIN_ROLE.id]), STAFF)).rejects.toThrow(SUPER_ADMIN_ASSIGN_MESSAGE);

      expect(transactions).toBe(0);
      expect(savedUsers).toEqual([]);
      expect(inserted).toEqual([]);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('SUPER_ADMIN smuggled in as the only role is refused the same way', async () => {
      await expect(service.create(dto([SUPER_ADMIN_ROLE.id]), STAFF)).rejects.toThrow(SUPER_ADMIN_ASSIGN_MESSAGE);

      expect(savedUsers).toEqual([]);
    });

    it('a SUPER_ADMIN actor can create a SUPER_ADMIN account — the user and its roles land in one transaction, audited as the actor', async () => {
      const created = await service.create(dto([OPERATIONS_ROLE.id, SUPER_ADMIN_ROLE.id]), ROOT);

      expect(created.id).toBe(200);
      expect(transactions).toBe(1);
      expect(rolesOf(200)).toEqual([OPERATIONS_ROLE.id, SUPER_ADMIN_ROLE.id]);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ moduleName: 'users', entityId: 200, action: 'CREATE', performedBy: 99 }),
        expect.anything(),
      );
    });

    it('a non-SUPER_ADMIN actor can create an account with ordinary roles — ADMIN included', async () => {
      const created = await service.create(dto([OPERATIONS_ROLE.id, ADMIN_ROLE.id]), STAFF);

      expect(rolesOf(created.id)).toEqual([OPERATIONS_ROLE.id, ADMIN_ROLE.id]);
    });

    it('an unknown role id is a 404 and no user is created', async () => {
      await expect(service.create(dto([OPERATIONS_ROLE.id, 4040]), ROOT)).rejects.toThrow(NotFoundException);

      expect(transactions).toBe(0);
      expect(savedUsers).toEqual([]);
    });
  });

  describe('update — profile and enabled state only', () => {
    it("a non-SUPER_ADMIN actor cannot edit a SUPER_ADMIN's account (403, nothing saved) — EDIT_USER is not a takeover path", async () => {
      await expect(service.update(5, { firstName: 'Hijacked' } as any, STAFF)).rejects.toThrow(ForbiddenException);
      await expect(service.update(5, { firstName: 'Hijacked' } as any, STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

      expect(savedUsers).toEqual([]);
      expect(transactions).toBe(0);
    });

    it('...including an attempt to deactivate or re-email them', async () => {
      await expect(service.update(6, { active: false } as any, STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);
      await expect(service.update(6, { email: 'attacker@example.com' } as any, STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

      expect(savedUsers).toEqual([]);
    });

    it('a SUPER_ADMIN actor can edit a SUPER_ADMIN account', async () => {
      await expect(service.update(5, { firstName: 'Renamed' } as any, ROOT)).resolves.toMatchObject({ firstName: 'Renamed' });
    });

    it('a non-SUPER_ADMIN actor can edit an ordinary account', async () => {
      await expect(service.update(8, { firstName: 'Renamed' } as any, STAFF)).resolves.toMatchObject({ firstName: 'Renamed' });
    });

    it('nobody can deactivate their OWN account — 403, nothing saved', async () => {
      await expect(service.update(8, { active: false } as any, staff(8))).rejects.toThrow(ForbiddenException);
      await expect(service.update(8, { active: false } as any, staff(8))).rejects.toThrow('You cannot deactivate your own account.');
      await expect(service.update(5, { active: false } as any, superAdmin(5))).rejects.toThrow('You cannot deactivate your own account.');

      expect(savedUsers).toEqual([]);
    });

    it('a user can still edit their own profile (only deactivating themselves is refused)', async () => {
      await expect(service.update(8, { firstName: 'Me', active: true } as any, staff(8))).resolves.toMatchObject({ firstName: 'Me' });
    });

    it('the LAST active SUPER_ADMIN cannot be deactivated — 403 under the row lock, nothing saved', async () => {
      table = table.filter((r) => r.id !== 21); // user 5 is now the only SUPER_ADMIN

      await expect(service.update(5, { active: false } as any, ROOT)).rejects.toThrow(ForbiddenException);
      await expect(service.update(5, { active: false } as any, ROOT)).rejects.toThrow(LAST_ACTIVE('deactivate'));

      expect(savedUsers).toEqual([]);
      expect(userStates[5].active).toBe(true);
    });

    it('a DEACTIVATED second SUPER_ADMIN does not count — the remaining active one is still the last and cannot be deactivated', async () => {
      userStates[6] = { active: false, deletedAt: null };

      await expect(service.update(5, { active: false } as any, ROOT)).rejects.toThrow(LAST_ACTIVE('deactivate'));
    });

    it('the INITIAL SUPER_ADMIN (user 5) cannot be deactivated even while another ACTIVE SUPER_ADMIN exists — 403 under the row lock, nothing saved', async () => {
      await expect(service.update(5, { active: false } as any, ROOT)).rejects.toThrow(ForbiddenException);
      await expect(service.update(5, { active: false } as any, ROOT)).rejects.toThrow(initialSuperAdminProtectedMessage('deactivate'));

      expect(savedUsers).toEqual([]);
      expect(userStates[5].active).toBe(true);
    });

    it('a SUPER_ADMIN who is NOT the initial one can be deactivated while another ACTIVE SUPER_ADMIN exists', async () => {
      await expect(service.update(6, { active: false } as any, ROOT)).resolves.toMatchObject({ active: false });

      expect(savedUsers).toHaveLength(1);
    });

    it('re-saving an already-inactive SUPER_ADMIN as inactive is not a deactivation and takes no last-admin lock', async () => {
      userStates[5] = { active: false, deletedAt: null };
      table = table.filter((r) => r.id !== 21);

      await expect(service.update(5, { active: false, firstName: 'Still gone' } as any, ROOT)).resolves.toBeDefined();
    });

    it('the saved user and the audit row never carry the password hash', async () => {
      await service.update(8, { firstName: 'Renamed' } as any, STAFF);

      const [{ newValue, oldValue }] = auditService.record.mock.calls.map(([entry]) => entry);
      expect(newValue).not.toHaveProperty('passwordHash');
      expect(oldValue).not.toHaveProperty('passwordHash');
    });
  });

  describe('remove — soft delete', () => {
    it('refuses to delete your OWN account — 403, nothing removed', async () => {
      await expect(service.remove(8, staff(8))).rejects.toThrow(ForbiddenException);
      await expect(service.remove(5, superAdmin(5))).rejects.toThrow('You cannot delete your own account.');

      expect(softRemoved).toEqual([]);
      expect(transactions).toBe(0);
    });

    it("a non-SUPER_ADMIN actor (DELETE_USER alone) cannot delete a SUPER_ADMIN's account — 403, nothing removed", async () => {
      await expect(service.remove(6, STAFF)).rejects.toThrow(ForbiddenException);
      await expect(service.remove(6, STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

      expect(softRemoved).toEqual([]);
      expect(rolesOf(6)).toEqual([SUPER_ADMIN_ROLE.id]);
    });

    it('refuses to delete the LAST active SUPER_ADMIN even for a SUPER_ADMIN — 403 under the row lock, nothing removed', async () => {
      table = table.filter((r) => r.id !== 21); // user 5 is now the only SUPER_ADMIN

      await expect(service.remove(5, ROOT)).rejects.toThrow(ForbiddenException);
      await expect(service.remove(5, ROOT)).rejects.toThrow(LAST_ACTIVE('delete'));

      expect(softRemoved).toEqual([]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
    });

    it('a DEACTIVATED second SUPER_ADMIN does not count — the active one cannot be deleted', async () => {
      userStates[6] = { active: false, deletedAt: null };

      await expect(service.remove(5, ROOT)).rejects.toThrow(LAST_ACTIVE('delete'));
    });

    it('the INITIAL SUPER_ADMIN (user 5) cannot be deleted even while another active SUPER_ADMIN exists — 403 under the row lock, nothing removed', async () => {
      await expect(service.remove(5, ROOT)).rejects.toThrow(ForbiddenException);
      await expect(service.remove(5, ROOT)).rejects.toThrow(initialSuperAdminProtectedMessage('delete'));

      expect(softRemoved).toEqual([]);
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('deletes a SUPER_ADMIN who is NOT the initial one while another active one exists — and cleans up EVERYTHING that pointed at the account, in the one transaction', async () => {
      await service.remove(6, ROOT);

      expect(transactions).toBe(1);
      expect(softRemoved).toEqual([6]);
      expect(rolesOf(6)).toEqual([]); // role assignments gone
      expect(deletedAllRolesFor).toEqual([6]);
      expect(inlinePolicyDeletes).toEqual([{ userId: 6 }]); // its own inline policies gone
      expect(sessionRevocations).toHaveLength(1); // live sessions revoked
      expect(sessionRevocations[0]).toMatchObject({
        entity: RefreshToken,
        params: { id: 6, type: 'staff' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          moduleName: 'users',
          entityId: 6,
          action: 'DELETE',
          performedBy: 99,
          oldValue: expect.objectContaining({ roleIds: [SUPER_ADMIN_ROLE.id] }),
        }),
        expect.anything(),
      );
      expect(rolesOf(5)).toEqual([SUPER_ADMIN_ROLE.id, ADMIN_ROLE.id]); // the initial administrator is untouched
    });

    it('the audit row of a deletion never carries the password hash', async () => {
      await service.remove(8, STAFF);

      const [{ oldValue }] = auditService.record.mock.calls.map(([entry]) => entry);
      expect(oldValue).not.toHaveProperty('passwordHash');
    });

    it('a non-SUPER_ADMIN actor can delete an ordinary account', async () => {
      await service.remove(8, STAFF);

      expect(softRemoved).toEqual([8]);
    });

    it('an unknown user is a 404', async () => {
      await expect(service.remove(99, ROOT)).rejects.toThrow(NotFoundException);
    });

    it('a failure partway rolls the whole deletion back — no half-cleaned account is left behind', async () => {
      auditService.record.mockRejectedValueOnce(new Error('audit down'));

      await expect(service.remove(8, STAFF)).rejects.toThrow('audit down');

      expect(userStates[8].deletedAt).toBeNull();
      expect(rolesOf(8)).toEqual([OPERATIONS_ROLE.id]);
    });
  });
});

describe('UserService', () => {
  let service: UserService;
  let usersRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock; manager: { transaction: jest.Mock } };
  let txUsersRepo: { save: jest.Mock };
  let txManager: { getRepository: jest.Mock; createQueryBuilder: jest.Mock; connection: { getMetadata: jest.Mock } };
  let releaseQuery: { update: jest.Mock; set: jest.Mock; where: jest.Mock; andWhere: jest.Mock; execute: jest.Mock };
  let roleService: { findOne: jest.Mock; findByName: jest.Mock };
  let rolePermissionsService: { getUserPermissions: jest.Mock };
  let attributeService: { isMandatory: jest.Mock };
  let lovService: { findActiveLanguages: jest.Mock };
  let userRoleService: {
    getRolesForUser: jest.Mock;
    getRolesForUsers: jest.Mock;
    getRoleRefsForUser: jest.Mock;
    getUsersByRoleCapability: jest.Mock;
    addRolesToUser: jest.Mock;
    removeRoleFromUser: jest.Mock;
    assertActorMayModifyUser: jest.Mock;
    assertNotLastActiveAdministrator: jest.Mock;
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    txUsersRepo = { save: jest.fn().mockImplementation((u) => Promise.resolve(Object.assign(u, { id: u.id ?? 77 }))) };
    releaseQuery = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    txManager = {
      getRepository: jest.fn().mockReturnValue(txUsersRepo),
      createQueryBuilder: jest.fn().mockReturnValue(releaseQuery),
      connection: {
        getMetadata: jest.fn().mockReturnValue({
          name: 'User',
          findColumnWithPropertyName: (property: string) => ({ databaseName: property }),
          deleteDateColumn: { databaseName: 'deleted_at' },
        }),
      },
    };
    usersRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((u) => Promise.resolve(u)),
      manager: { transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(txManager)) },
    };
    roleService = {
      findOne: jest
        .fn()
        .mockImplementation(async (id: number) => ROLE_TABLE.find((r) => r.id === id) ?? Promise.reject(new NotFoundException('Role not found'))),
      findByName: jest.fn(),
    };
    rolePermissionsService = { getUserPermissions: jest.fn().mockResolvedValue([]) };
    attributeService = { isMandatory: jest.fn().mockResolvedValue(false) };
    lovService = { findActiveLanguages: jest.fn().mockResolvedValue([]) };
    userRoleService = {
      getRolesForUser: jest.fn().mockResolvedValue([]),
      getRolesForUsers: jest.fn().mockResolvedValue(new Map()),
      getRoleRefsForUser: jest.fn().mockResolvedValue([]),
      getUsersByRoleCapability: jest.fn().mockResolvedValue([]),
      addRolesToUser: jest.fn().mockResolvedValue([]),
      removeRoleFromUser: jest.fn().mockResolvedValue(false),
      assertActorMayModifyUser: jest.fn().mockResolvedValue(undefined),
      assertNotLastActiveAdministrator: jest.fn().mockResolvedValue(undefined),
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
    const actor = staff(9);

    beforeEach(() => {
      usersRepo.findOne.mockResolvedValue(null); // email/mobile/employee-code uniqueness lookups find nothing
    });

    it('creates the user and assigns EVERY role in dto.roleIds, in order, inside the same transaction as the user row and the audit row — handing the actor through', async () => {
      const saved = await service.create(dto, actor);

      expect(saved.id).toBe(77);
      expect(usersRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(txUsersRepo.save).toHaveBeenCalledTimes(1);
      expect(userRoleService.addRolesToUser).toHaveBeenCalledWith(
        77,
        [OPERATIONS_ROLE.id, FINANCE_ROLE.id, ADMIN_ROLE.id],
        txManager,
        actor,
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ moduleName: 'users', entityId: 77, action: 'CREATE', performedBy: 9 }),
        txManager,
      );
    });

    it('validates that every role exists BEFORE anything is written — one unknown id is a 404 and no user is created', async () => {
      await expect(service.create({ ...dto, roleIds: [OPERATIONS_ROLE.id, 4040] }, actor)).rejects.toThrow(NotFoundException);

      expect(usersRepo.manager.transaction).not.toHaveBeenCalled();
      expect(txUsersRepo.save).not.toHaveBeenCalled();
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
    });

    it('checks each distinct role id once', async () => {
      await service.create({ ...dto, roleIds: [FINANCE_ROLE.id, OPERATIONS_ROLE.id] }, actor);

      expect(roleService.findOne).toHaveBeenCalledTimes(2);
      expect(roleService.findOne).toHaveBeenCalledWith(FINANCE_ROLE.id);
      expect(roleService.findOne).toHaveBeenCalledWith(OPERATIONS_ROLE.id);
    });

    it('a failure while assigning roles rolls the whole creation back — the error propagates out of the one transaction', async () => {
      userRoleService.addRolesToUser.mockRejectedValue(new Error('constraint'));

      await expect(service.create(dto, actor)).rejects.toThrow('constraint');

      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('refuses SUPER_ADMIN for a non-SUPER_ADMIN actor before ANY write — no transaction, no role call', async () => {
      await expect(service.create({ ...dto, roleIds: [SUPER_ADMIN_ROLE.id] }, actor)).rejects.toThrow(SUPER_ADMIN_ASSIGN_MESSAGE);

      expect(usersRepo.manager.transaction).not.toHaveBeenCalled();
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
    });

    it('lets a SUPER_ADMIN actor and the system actor create a SUPER_ADMIN account', async () => {
      await expect(service.create({ ...dto, roleIds: [SUPER_ADMIN_ROLE.id] }, superAdmin(1))).resolves.toBeDefined();
      await expect(service.create({ ...dto, roleIds: [SUPER_ADMIN_ROLE.id] }, SYSTEM_ACTOR)).resolves.toBeDefined();
    });

    it('releases the email / mobile / employee code a SOFT-DELETED account still holds, inside the creating transaction', async () => {
      await service.create({ ...dto, mobile: '9999999999', employeeCode: 'EMP-9' }, actor);

      expect(txManager.createQueryBuilder).toHaveBeenCalledTimes(3); // email, mobile, employee code
      expect(releaseQuery.execute).toHaveBeenCalledTimes(3);
    });

    it('stores only a bcrypt hash of the password; the returned user and the audit row never carry it', async () => {
      const password = 'Str0ng-Password-For-Tests!';

      const saved = await service.create({ ...dto, password }, actor);

      const [user] = txUsersRepo.save.mock.calls[0];
      expect(user.passwordHash).toEqual(expect.any(String));
      expect(user.passwordHash).not.toContain(password);
      expect(await bcrypt.compare(password, user.passwordHash)).toBe(true);
      expect(saved).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(auditService.record.mock.calls)).not.toContain(user.passwordHash);
      expect(JSON.stringify(auditService.record.mock.calls)).not.toContain(password);
    });

    it('an account created without a password has no hash and cannot sign in until one is set', async () => {
      await service.create(dto, actor);

      const [user] = txUsersRepo.save.mock.calls[0];
      expect(user.passwordHash).toBeNull();
    });
  });

  describe('update — never touches roles', () => {
    it('saves the profile change and calls NO user-role write method, even when handed a stale role field', async () => {
      usersRepo.findOne.mockResolvedValue(buildUserRow(5));
      userRoleService.getRolesForUser.mockResolvedValue([SUPER_ADMIN_ROLE]);

      // The global ValidationPipe rejects these with a 400 before they get here; this proves nothing
      // downstream would act on one anyway.
      await expect(
        service.update(5, { firstName: 'Renamed', roleId: ADMIN_ROLE.id, roleIds: [ADMIN_ROLE.id] } as any, superAdmin(5)),
      ).resolves.toBeDefined();

      expect(txUsersRepo.save).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Renamed' }));
      expect(userRoleService.addRolesToUser).not.toHaveBeenCalled();
      expect(userRoleService.removeRoleFromUser).not.toHaveBeenCalled();
      expect(roleService.findOne).not.toHaveBeenCalled();
      expect(roleService.findByName).not.toHaveBeenCalled();
    });

    it('never changes a password: a password sent to update() is ignored, and nothing writes passwordHash', async () => {
      usersRepo.findOne.mockResolvedValue(buildUserRow(5));
      userRoleService.getRolesForUser.mockResolvedValue([ADMIN_ROLE]);

      await service.update(5, { firstName: 'Me', password: 'Sneaky-New-Password-1!', passwordHash: 'x' } as any, superAdmin(5));

      const [saved] = txUsersRepo.save.mock.calls[0];
      expect(saved).not.toHaveProperty('passwordHash');
      expect(saved).not.toHaveProperty('password');
    });

    it('a user can still edit their own profile — the old self-role-change refusal is gone from update (it now lives in addRoles/removeRole)', async () => {
      usersRepo.findOne.mockResolvedValue(buildUserRow(5));
      userRoleService.getRolesForUser.mockResolvedValue([ADMIN_ROLE]);

      await expect(service.update(5, { firstName: 'Me' } as any, superAdmin(5))).resolves.toBeDefined();
      expect(txUsersRepo.save).toHaveBeenCalled();
    });

    it('asks UserRoleService whether the actor may modify this account (the SUPER_ADMIN protection) before anything is written', async () => {
      usersRepo.findOne.mockResolvedValue(buildUserRow(5));
      userRoleService.getRolesForUser.mockResolvedValue([SUPER_ADMIN_ROLE]);
      userRoleService.assertActorMayModifyUser.mockRejectedValue(new ForbiddenException(SUPER_ADMIN_MODIFY_MESSAGE));

      await expect(service.update(5, { firstName: 'X' } as any, staff(50))).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

      expect(userRoleService.assertActorMayModifyUser).toHaveBeenCalledWith(staff(50), 5);
      expect(usersRepo.manager.transaction).not.toHaveBeenCalled();
      expect(txUsersRepo.save).not.toHaveBeenCalled();
    });

    it('a deactivation takes the last-active-SUPER_ADMIN check inside the same transaction as the save; a plain edit does not', async () => {
      usersRepo.findOne.mockResolvedValue(buildUserRow(8));
      userRoleService.getRolesForUser.mockResolvedValue([OPERATIONS_ROLE]);

      await service.update(8, { firstName: 'Plain' } as any, staff(50));
      expect(userRoleService.assertNotLastActiveAdministrator).not.toHaveBeenCalled();

      await service.update(8, { active: false } as any, staff(50));
      expect(userRoleService.assertNotLastActiveAdministrator).toHaveBeenCalledWith(8, txManager, 'deactivate');
    });

    it('refuses to deactivate your own account before opening a transaction', async () => {
      usersRepo.findOne.mockResolvedValue(buildUserRow(8));
      userRoleService.getRolesForUser.mockResolvedValue([OPERATIONS_ROLE]);

      await expect(service.update(8, { active: false } as any, staff(8))).rejects.toThrow('You cannot deactivate your own account.');

      expect(usersRepo.manager.transaction).not.toHaveBeenCalled();
    });
  });

  describe('findAuthState — the lean per-request read behind JwtStrategy', () => {
    it('returns the active flag, the mandatory-password-change flag and the live role refs from two lean queries', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 5, active: true, mustChangePassword: true });
      userRoleService.getRoleRefsForUser.mockResolvedValue([
        { id: OPERATIONS_ROLE.id, roleName: ORDINARY_ROLE_NAMES.OPERATIONS },
        { id: SUPER_ADMIN_ROLE.id, roleName: ROLES.SUPER_ADMIN },
      ]);

      await expect(service.findAuthState(5)).resolves.toEqual({
        id: 5,
        active: true,
        mustChangePassword: true,
        roles: [
          { id: OPERATIONS_ROLE.id, roleName: ORDINARY_ROLE_NAMES.OPERATIONS },
          { id: SUPER_ADMIN_ROLE.id, roleName: ROLES.SUPER_ADMIN },
        ],
      });
      expect(usersRepo.findOne).toHaveBeenCalledWith({
        where: { id: 5 },
        select: { id: true, active: true, mustChangePassword: true },
        loadEagerRelations: false,
      });
      expect(userRoleService.getRoleRefsForUser).toHaveBeenCalledWith(5);
      expect(userRoleService.getRolesForUser).not.toHaveBeenCalled(); // not the heavy, relation-loading read
    });

    it('reports an inactive user as inactive (JwtStrategy turns that into a 401 on the very next request)', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 5, active: false, mustChangePassword: false });

      await expect(service.findAuthState(5)).resolves.toMatchObject({ active: false });
    });

    it('treats anything but a literal true as "no password change required" — a missing/NULL column never locks a user out', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 5, active: true, mustChangePassword: null });

      await expect(service.findAuthState(5)).resolves.toMatchObject({ mustChangePassword: false });
    });

    it('is a 404 for an unknown user, without reading any roles', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.findAuthState(5)).rejects.toThrow(NotFoundException);
      expect(userRoleService.getRoleRefsForUser).not.toHaveBeenCalled();
    });

    it('is read fresh every time — nothing is cached between two calls', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 5, active: true, mustChangePassword: false });

      await service.findAuthState(5);
      await service.findAuthState(5);

      expect(usersRepo.findOne).toHaveBeenCalledTimes(2);
      expect(userRoleService.getRoleRefsForUser).toHaveBeenCalledTimes(2);
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

    describe('a SUPER_ADMIN account is not found by a viewer who is not a super administrator', () => {
      const delegated: Actor = { kind: 'user', id: 2, roleNames: ['USER_MANAGER'] };
      const superAdmin: Actor = { kind: 'user', id: 1, roleNames: [ROLES.SUPER_ADMIN] };

      it('is a 404 — the account\'s existence is not confirmed', async () => {
        usersRepo.findOne.mockResolvedValue(buildUserRow(5));
        userRoleService.getRolesForUser.mockResolvedValue([OPERATIONS_ROLE, SUPER_ADMIN_ROLE]);

        await expect(service.findOne(5, delegated)).rejects.toThrow(NotFoundException);
      });

      it('shows an ordinary account to the same viewer', async () => {
        usersRepo.findOne.mockResolvedValue(buildUserRow(5));
        userRoleService.getRolesForUser.mockResolvedValue([OPERATIONS_ROLE]);

        await expect(service.findOne(5, delegated)).resolves.toMatchObject({ id: 5 });
      });

      it('shows it to a super administrator, to the system and to an internal caller with no viewer', async () => {
        usersRepo.findOne.mockResolvedValue(buildUserRow(5));
        userRoleService.getRolesForUser.mockResolvedValue([SUPER_ADMIN_ROLE]);

        await expect(service.findOne(5, superAdmin)).resolves.toMatchObject({ id: 5 });
        await expect(service.findOne(5, SYSTEM_ACTOR)).resolves.toMatchObject({ id: 5 });
        await expect(service.findOne(5)).resolves.toMatchObject({ id: 5 });
      });
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
        mobile: null,
        employeeCode: 'EMP5',
        designation: 'Analyst',
        role: { id: OPERATIONS_ROLE.id, name: ORDINARY_ROLE_NAMES.OPERATIONS },
        roles: [
          { id: OPERATIONS_ROLE.id, name: ORDINARY_ROLE_NAMES.OPERATIONS },
          { id: SUPER_ADMIN_ROLE.id, name: ROLES.SUPER_ADMIN },
        ],
        themeMode: 'dark',
        navTheme: null,
        preferredLanguageCode: 'en',
        permissions: [{ moduleName: 'Users' }],
      });
      expect(rolePermissionsService.getUserPermissions).toHaveBeenCalledWith(OPERATIONS_ROLE.id);
    });

    it('never exposes the password hash', async () => {
      usersRepo.findOne.mockResolvedValue({ ...profileUser(), passwordHash: '$2a$12$secret' });
      userRoleService.getRolesForUser.mockResolvedValue([OPERATIONS_ROLE]);

      const profile = await service.getProfile(5);

      expect(JSON.stringify(profile)).not.toContain('passwordHash');
      expect(JSON.stringify(profile)).not.toContain('$2a$12$secret');
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
      { userId: 4, roleId: FINANCE_ROLE.id, roleName: ORDINARY_ROLE_NAMES.FINANCE },
      { userId: 9, roleId: ADMIN_ROLE.id, roleName: ORDINARY_ROLE_NAMES.ADMIN },
      { userId: 4, roleId: OPERATIONS_ROLE.id, roleName: ORDINARY_ROLE_NAMES.OPERATIONS },
    ];
    const userRow = (id: number) => ({ id, firstName: `U${id}`, lastName: 'L', employeeCode: `E${id}` });

    beforeEach(() => {
      userRoleService.getUsersByRoleCapability.mockResolvedValue(GRANTS);
      usersRepo.find.mockResolvedValue([userRow(4), userRow(9)]);
    });

    it("lists a multi-role user once, under their FIRST-assigned qualifying role's name", async () => {
      const managers = await service.getReportingManagers();

      expect(managers).toEqual([
        { id: 4, firstName: 'U4', lastName: 'L', employeeCode: 'E4', roleName: ORDINARY_ROLE_NAMES.FINANCE },
        { id: 9, firstName: 'U9', lastName: 'L', employeeCode: 'E9', roleName: ORDINARY_ROLE_NAMES.ADMIN },
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
