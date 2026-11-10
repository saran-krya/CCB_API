import { ForbiddenException } from '@nestjs/common';
import {
  Actor,
  SUPER_ADMIN_ASSIGN_MESSAGE,
  SUPER_ADMIN_MODIFY_MESSAGE,
  SYSTEM_ACTOR,
} from '../../common/security/actor';
import { UserRoleService } from './user-role.service';
import { UserRole } from './entities/user-role.entity';
import { Role } from '../role/entities/role.entity';

// Isolated unit tests for UserRoleService's write paths — the multi-role assignment model: a user holds
// MANY roles, roles are only ever added (idempotently) or revoked one at a time, and the business rules on
// those writes are enforced in the same transaction as the write, against rows locked with
// pessimistic_write. The rules, all decided here and never in a controller or the UI:
//   - only a SUPER_ADMIN may grant SUPER_ADMIN, and only a SUPER_ADMIN may change a SUPER_ADMIN's roles;
//   - no self-change, a user keeps at least one role, and the last ACTIVE SUPER_ADMIN can never be removed.
// No real database connection: the tables are an in-memory stand-in behind exactly the repository/manager
// surface the service touches (see `arrange`), which is enough to prove WHAT is written, WHEN each lock is
// taken and that a failure rolls the whole unit of work back — true lock contention is a database property
// and cannot be exercised by a mock, so the concurrency tests below assert the lock calls and their ORDER
// instead. (The throwaway-database run of the API exercises the same rules end to end over HTTP.)

interface Row {
  id: number;
  userId: number;
  roleId: number;
}

interface UserState {
  active: boolean;
  deletedAt: Date | null;
}

const SUPER_ADMIN = { id: 1, roleName: 'SUPER_ADMIN' };
const FINANCE = { id: 3, roleName: 'FINANCE' };
const OPERATIONS = { id: 7, roleName: 'OPERATIONS' };
const BILLING = { id: 9, roleName: 'BILLING' };
const ROLE_TABLE = [SUPER_ADMIN, FINANCE, OPERATIONS, BILLING];

const LAST_SUPER_ADMIN_MESSAGE = 'Cannot remove the last active SUPER_ADMIN — at least one active user must hold this role.';

// Who is acting. The privilege rules are decided against the actor's CURRENT role names (what JwtStrategy
// re-reads on every request), so every test says which kind of actor it is. `superAdmin(id)` is the generic
// "an administrator did this" actor; `staff(id)` has EDIT_USER-style authority only — a delegated
// administrator who is NOT a SUPER_ADMIN, which is exactly who must not be able to escalate.
const superAdmin = (id: number): Actor => ({ kind: 'user', id, roleNames: ['SUPER_ADMIN'] });
const staff = (id: number): Actor => ({ kind: 'user', id, roleNames: ['USER_MANAGER'] });
const ROOT = superAdmin(99);
const STAFF = staff(11);

function arrange(initialRows: Row[], userStates: Record<number, Partial<UserState>> = {}) {
  let rows: Row[] = initialRows.map((r) => ({ ...r }));
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
  // Ordered log of every lock and write, so a test can assert what happened BEFORE what.
  const events: string[] = [];
  const byId = (a: Row, b: Row) => a.id - b.id;
  const userState = (userId: number): UserState => ({ active: true, deletedAt: null, ...userStates[userId] });

  // A locking read always sees the latest committed rows, so it reads the live table, and it records
  // the lock mode plus whether it scanned one user's rows or one role's holders. A join that restricts to
  // active, non-deleted users (the SUPER_ADMIN-holder lock) is honoured against the users' state.
  const lockQueries: any[] = [];
  const lockQuery = () => {
    let mode = '';
    let params: { userId?: number; roleId?: number } = {};
    let liveUsersOnly = false;
    const qb: any = {
      setLock: jest.fn((m: string) => {
        mode = m;
        return qb;
      }),
      innerJoin: jest.fn((_relation: string, _alias: string, condition: string) => {
        liveUsersOnly = /user\.active/.test(condition) && /user\.deletedAt IS NULL/.test(condition);
        return qb;
      }),
      where: jest.fn((_sql: string, p: typeof params) => {
        params = p;
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      getMany: jest.fn(async () => {
        const scansUser = params.userId !== undefined;
        events.push(`${mode}:${scansUser ? 'user' : 'role'}`);
        return rows
          .filter((r) => (scansUser ? r.userId === params.userId : r.roleId === params.roleId))
          .filter((r) => !liveUsersOnly || (userState(r.userId).active && userState(r.userId).deletedAt === null))
          .sort(byId)
          .map((r) => ({ ...r }));
      }),
    };
    lockQueries.push(qb);
    return qb;
  };

  const txUserRoles = {
    find: jest.fn(async ({ where, relations }: { where: { userId: number }; relations?: { role?: boolean } }) =>
      rows
        .filter((r) => r.userId === where.userId)
        .sort(byId)
        .map((r) => ({ ...r, ...(relations?.role ? { role: ROLE_TABLE.find((role) => role.id === r.roleId) } : {}) })),
    ),
    create: jest.fn((data: Partial<Row>) => data),
    save: jest.fn(async (data: Row) => {
      rows.push({ ...data, id: nextId++ });
      events.push(`insert:${data.roleId}`);
      return data;
    }),
    delete: jest.fn(async (criteria: { userId: number; roleId: number }) => {
      rows = rows.filter((r) => !(r.userId === criteria.userId && r.roleId === criteria.roleId));
      events.push(`delete:${criteria.roleId}`);
    }),
    // Present only so a test can prove none of the soft-delete paths is ever taken.
    softDelete: jest.fn(),
    softRemove: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(() => lockQuery()),
  };
  const txRoles = {
    findOne: jest.fn(async ({ where }: { where: { id?: number; roleName?: string } }) =>
      ROLE_TABLE.find((r) => (where.id !== undefined ? r.id === where.id : r.roleName === where.roleName)) ?? null,
    ),
    // `where: { id: In([...]) }` — TypeORM's FindOperator exposes the list as `.value`.
    find: jest.fn(async ({ where }: { where: { id: { value: number[] } } }) => ROLE_TABLE.filter((r) => where.id.value.includes(r.id))),
  };
  const txManager = {
    getRepository: jest.fn((entity: unknown) => (entity === UserRole ? txUserRoles : entity === Role ? txRoles : undefined)),
  };
  // EntityManager.transaction commits when its callback resolves and rolls back when it throws —
  // modelled by restoring the table on a throw.
  const transaction = jest.fn(async (work: (m: unknown) => Promise<unknown>) => {
    const before = rows.map((r) => ({ ...r }));
    try {
      return await work(txManager);
    } catch (err) {
      rows = before;
      throw err;
    }
  });
  const plainRepo = { manager: { transaction, getRepository: txManager.getRepository } };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new UserRoleService(plainRepo as any, audit as any);

  return {
    service,
    audit,
    txManager,
    txUserRoles,
    txRoles,
    transaction,
    events,
    lockQueries,
    roleIdsOf: (userId: number) => rows.filter((r) => r.userId === userId).sort(byId).map((r) => r.roleId),
  };
}

describe('UserRoleService.addRolesToUser', () => {
  // User 55 already holds FINANCE.
  const ROWS: Row[] = [{ id: 1, userId: 55, roleId: FINANCE.id }];

  it('grants only the roles the user does not hold, in request order, and audits ASSIGN_ROLE once with the old and new role-id lists', async () => {
    const t = arrange(ROWS);

    const added = await t.service.addRolesToUser(55, [BILLING.id, FINANCE.id, OPERATIONS.id], undefined, STAFF);

    expect(added).toEqual([BILLING.id, OPERATIONS.id]);
    expect(t.roleIdsOf(55)).toEqual([FINANCE.id, BILLING.id, OPERATIONS.id]);
    expect(t.audit.record).toHaveBeenCalledTimes(1);
    expect(t.audit.record).toHaveBeenCalledWith(
      {
        moduleName: 'user_roles',
        entityId: 55,
        action: 'ASSIGN_ROLE',
        oldValue: { roleIds: [FINANCE.id] },
        newValue: { roleIds: [FINANCE.id, BILLING.id, OPERATIONS.id] },
        performedBy: 11,
      },
      t.txManager,
    );
  });

  it('grants a brand-new user several roles in request order — the first granted is the primary (lowest id) — and takes no row lock doing it', async () => {
    // UserService.create's shape: the user row was just inserted, so there is nothing to lock (a
    // locking read over that empty range would only gap-lock it and let two concurrent creations
    // deadlock on each other's gap lock).
    const t = arrange([]);

    await t.service.addRolesToUser(77, [OPERATIONS.id, FINANCE.id, BILLING.id], t.txManager as any, STAFF);

    expect(t.events).toEqual([`insert:${OPERATIONS.id}`, `insert:${FINANCE.id}`, `insert:${BILLING.id}`]);
    expect(t.roleIdsOf(77)).toEqual([OPERATIONS.id, FINANCE.id, BILLING.id]);
    expect(t.lockQueries).toHaveLength(0);
    expect(t.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: { roleIds: [] },
        newValue: { roleIds: [OPERATIONS.id, FINANCE.id, BILLING.id] },
      }),
      t.txManager,
    );
  });

  it('performs the whole grant — every insert and the audit row — in ONE transaction', async () => {
    const t = arrange(ROWS);

    await t.service.addRolesToUser(55, [BILLING.id, OPERATIONS.id], undefined, STAFF);

    expect(t.transaction).toHaveBeenCalledTimes(1);
  });

  it('skips ids the user already holds — a request that changes nothing writes nothing and audits nothing', async () => {
    const t = arrange(ROWS);

    const added = await t.service.addRolesToUser(55, [FINANCE.id], undefined, STAFF);

    expect(added).toEqual([]);
    expect(t.txUserRoles.save).not.toHaveBeenCalled();
    expect(t.audit.record).not.toHaveBeenCalled();
    expect(t.roleIdsOf(55)).toEqual([FINANCE.id]);
  });

  it('is idempotent: repeating the same request the second time is a no-op with no second audit row', async () => {
    const t = arrange(ROWS);

    expect(await t.service.addRolesToUser(55, [BILLING.id], undefined, STAFF)).toEqual([BILLING.id]);
    expect(await t.service.addRolesToUser(55, [BILLING.id], undefined, STAFF)).toEqual([]);

    expect(t.roleIdsOf(55)).toEqual([FINANCE.id, BILLING.id]);
    expect(t.audit.record).toHaveBeenCalledTimes(1);
  });

  it('grants a role id repeated within one request only once', async () => {
    const t = arrange(ROWS);

    const added = await t.service.addRolesToUser(55, [BILLING.id, BILLING.id], undefined, STAFF);

    expect(added).toEqual([BILLING.id]);
    expect(t.txUserRoles.save).toHaveBeenCalledTimes(1);
  });

  it('only ever ADDS — it never deletes or replaces anything a user already holds (what makes the boot-time seed safe)', async () => {
    const t = arrange([
      { id: 1, userId: 55, roleId: FINANCE.id },
      { id: 2, userId: 55, roleId: OPERATIONS.id },
    ]);

    await t.service.addRolesToUser(55, [SUPER_ADMIN.id], undefined, SYSTEM_ACTOR); // exactly the seed's call shape

    expect(t.roleIdsOf(55)).toEqual([FINANCE.id, OPERATIONS.id, SUPER_ADMIN.id]);
    expect(t.txUserRoles.delete).not.toHaveBeenCalled();
    expect(t.txUserRoles.softDelete).not.toHaveBeenCalled();
    expect(t.txUserRoles.remove).not.toHaveBeenCalled();
  });

  it('for the system actor (boot-time seeding) it still audits, with performedBy left undefined for AuditService to null', async () => {
    const t = arrange([{ id: 1, userId: 1, roleId: FINANCE.id }]);

    await t.service.addRolesToUser(1, [SUPER_ADMIN.id], undefined, SYSTEM_ACTOR);

    expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ASSIGN_ROLE', performedBy: undefined }), t.txManager);
  });

  it("joins the caller's transaction when one is passed: the same manager does the write and the audit insert, and no transaction of its own is opened", async () => {
    const t = arrange(ROWS);

    await t.service.addRolesToUser(55, [BILLING.id], t.txManager as any, STAFF);

    expect(t.transaction).not.toHaveBeenCalled();
    expect(t.txManager.getRepository).toHaveBeenCalledWith(UserRole);
    expect(t.audit.record).toHaveBeenCalledWith(expect.any(Object), t.txManager);
  });

  it('an empty request does nothing at all — not even a transaction', async () => {
    const t = arrange(ROWS);

    expect(await t.service.addRolesToUser(55, [], undefined, STAFF)).toEqual([]);

    expect(t.transaction).not.toHaveBeenCalled();
    expect(t.audit.record).not.toHaveBeenCalled();
  });

  it('the grant and its audit row commit or roll back together: a failing audit insert leaves no role behind', async () => {
    const t = arrange(ROWS);
    t.audit.record.mockRejectedValueOnce(new Error('audit down'));

    await expect(t.service.addRolesToUser(55, [BILLING.id, OPERATIONS.id], undefined, STAFF)).rejects.toThrow('audit down');

    expect(t.roleIdsOf(55)).toEqual([FINANCE.id]);
  });

  describe('SUPER_ADMIN assignment is reserved to a SUPER_ADMIN', () => {
    it('a non-SUPER_ADMIN actor (EDIT_USER / CREATE_USER alone) is refused with 403 and the SUPER_ADMIN message; nothing is written or audited', async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [SUPER_ADMIN.id], undefined, STAFF)).rejects.toThrow(ForbiddenException);
      await expect(t.service.addRolesToUser(55, [SUPER_ADMIN.id], undefined, STAFF)).rejects.toThrow(SUPER_ADMIN_ASSIGN_MESSAGE);

      expect(t.txUserRoles.save).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.roleIdsOf(55)).toEqual([FINANCE.id]);
    });

    it('the refusal holds however the request is shaped: SUPER_ADMIN smuggled into a list of ordinary roles refuses the WHOLE request — not even the ordinary roles are granted', async () => {
      const t = arrange(ROWS);

      await expect(
        t.service.addRolesToUser(55, [BILLING.id, SUPER_ADMIN.id, OPERATIONS.id], undefined, STAFF),
      ).rejects.toThrow(SUPER_ADMIN_ASSIGN_MESSAGE);
      await expect(t.service.addRolesToUser(55, [SUPER_ADMIN.id, SUPER_ADMIN.id], undefined, STAFF)).rejects.toThrow(
        SUPER_ADMIN_ASSIGN_MESSAGE,
      );

      expect(t.roleIdsOf(55)).toEqual([FINANCE.id]);
    });

    it('a non-SUPER_ADMIN actor with a stale or empty role list is treated exactly the same', async () => {
      const t = arrange(ROWS);
      const noRoles: Actor = { kind: 'user', id: 12, roleNames: [] };

      await expect(t.service.addRolesToUser(55, [SUPER_ADMIN.id], undefined, noRoles)).rejects.toThrow(SUPER_ADMIN_ASSIGN_MESSAGE);
    });

    it('the rule is decided from the role rows read inside the transaction, never from a name the caller supplies', async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [SUPER_ADMIN.id], undefined, STAFF)).rejects.toThrow(SUPER_ADMIN_ASSIGN_MESSAGE);

      expect(t.txRoles.find).toHaveBeenCalledTimes(1);
    });

    it('an authenticated SUPER_ADMIN may grant SUPER_ADMIN — the role lands, the audit row names the actor', async () => {
      const t = arrange(ROWS);

      const added = await t.service.addRolesToUser(55, [SUPER_ADMIN.id], undefined, ROOT);

      expect(added).toEqual([SUPER_ADMIN.id]);
      expect(t.roleIdsOf(55)).toEqual([FINANCE.id, SUPER_ADMIN.id]);
      expect(t.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ASSIGN_ROLE', performedBy: 99, newValue: { roleIds: [FINANCE.id, SUPER_ADMIN.id] } }),
        t.txManager,
      );
    });

    it('the system actor (boot-time seeding of the default admin) may grant it too', async () => {
      const t = arrange([]);

      await expect(t.service.addRolesToUser(1, [SUPER_ADMIN.id], t.txManager as any, SYSTEM_ACTOR)).resolves.toEqual([SUPER_ADMIN.id]);
    });

    it('a non-SUPER_ADMIN actor may still grant every ordinary role', async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [BILLING.id, OPERATIONS.id], undefined, STAFF)).resolves.toEqual([
        BILLING.id,
        OPERATIONS.id,
      ]);
    });

    it('asking a non-SUPER_ADMIN actor to "grant" SUPER_ADMIN to someone who ALREADY holds it changes nothing, so it is the same quiet no-op as any repeat', async () => {
      const t = arrange([
        { id: 1, userId: 55, roleId: FINANCE.id },
        { id: 2, userId: 55, roleId: SUPER_ADMIN.id },
      ]);

      await expect(t.service.addRolesToUser(55, [SUPER_ADMIN.id], undefined, STAFF)).resolves.toEqual([]);

      expect(t.txUserRoles.save).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
    });

    it('a non-SUPER_ADMIN actor cannot change the roles of a user who holds SUPER_ADMIN — even to add an ordinary role', async () => {
      const t = arrange([
        { id: 1, userId: 55, roleId: FINANCE.id },
        { id: 2, userId: 55, roleId: SUPER_ADMIN.id },
      ]);

      await expect(t.service.addRolesToUser(55, [BILLING.id], undefined, STAFF)).rejects.toThrow(ForbiddenException);
      await expect(t.service.addRolesToUser(55, [BILLING.id], undefined, STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

      expect(t.roleIdsOf(55)).toEqual([FINANCE.id, SUPER_ADMIN.id]);
      expect(t.audit.record).not.toHaveBeenCalled();
    });

    it("a SUPER_ADMIN may change a SUPER_ADMIN's roles", async () => {
      const t = arrange([
        { id: 1, userId: 55, roleId: FINANCE.id },
        { id: 2, userId: 55, roleId: SUPER_ADMIN.id },
      ]);

      await expect(t.service.addRolesToUser(55, [BILLING.id], undefined, ROOT)).resolves.toEqual([BILLING.id]);
    });
  });

  describe('self-change rule', () => {
    it("refuses to grant roles to the actor's OWN user — even a SUPER_ADMIN's; nothing is written, nothing audited", async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [OPERATIONS.id], undefined, superAdmin(55))).rejects.toThrow(ForbiddenException);
      await expect(t.service.addRolesToUser(55, [OPERATIONS.id], undefined, superAdmin(55))).rejects.toThrow(
        'You cannot change your own roles.',
      );

      expect(t.txUserRoles.save).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.roleIdsOf(55)).toEqual([FINANCE.id]);
    });

    it('a request by the actor on their own user that would change nothing is a no-op and stays allowed', async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [FINANCE.id], undefined, superAdmin(55))).resolves.toEqual([]);

      expect(t.audit.record).not.toHaveBeenCalled();
    });

    it("never blocks granting roles to a DIFFERENT user's account", async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [OPERATIONS.id], undefined, superAdmin(99))).resolves.toEqual([OPERATIONS.id]);
    });

    it('decides "does this change anything" from the rows it reads inside its own transaction, never from anything the caller supplies', async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [OPERATIONS.id], undefined, superAdmin(55))).rejects.toThrow(ForbiddenException);

      expect(t.txUserRoles.find).toHaveBeenCalledWith({ where: { userId: 55 }, order: { id: 'ASC' } });
    });
  });

  describe('concurrent identical grants (a double-submit racing past the read)', () => {
    const duplicateKey = () =>
      Object.assign(new Error("Duplicate entry '55-9' for key 'IDX_23ed6f04fe43066df08379fd03'"), { code: 'ER_DUP_ENTRY' });

    it('a duplicate-key error on insert means the role IS held now: no error, not reported as added, no audit', async () => {
      const t = arrange(ROWS);
      t.txUserRoles.save.mockRejectedValueOnce(duplicateKey());

      await expect(t.service.addRolesToUser(55, [BILLING.id], undefined, STAFF)).resolves.toEqual([]);

      expect(t.audit.record).not.toHaveBeenCalled();
    });

    it('only the roles this call really inserted are reported and audited when one of several collides', async () => {
      const t = arrange(ROWS);
      t.txUserRoles.save.mockRejectedValueOnce(duplicateKey());

      const added = await t.service.addRolesToUser(55, [BILLING.id, OPERATIONS.id], undefined, STAFF);

      expect(added).toEqual([OPERATIONS.id]);
      expect(t.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ newValue: { roleIds: [FINANCE.id, OPERATIONS.id] } }),
        t.txManager,
      );
    });

    it('any other database error is not swallowed', async () => {
      const t = arrange(ROWS);
      t.txUserRoles.save.mockRejectedValueOnce(Object.assign(new Error('Cannot add or update a child row'), { code: 'ER_NO_REFERENCED_ROW_2' }));

      await expect(t.service.addRolesToUser(55, [BILLING.id], undefined, STAFF)).rejects.toThrow('Cannot add or update a child row');

      expect(t.audit.record).not.toHaveBeenCalled();
    });
  });
});

describe('UserRoleService.removeRoleFromUser', () => {
  // User 5 holds SUPER_ADMIN (assigned first) and FINANCE; user 6 holds SUPER_ADMIN and OPERATIONS;
  // user 7 holds only FINANCE; user 8 holds FINANCE and BILLING (no SUPER_ADMIN anywhere).
  const ROWS: Row[] = [
    { id: 11, userId: 5, roleId: SUPER_ADMIN.id },
    { id: 12, userId: 5, roleId: FINANCE.id },
    { id: 21, userId: 6, roleId: SUPER_ADMIN.id },
    { id: 22, userId: 6, roleId: OPERATIONS.id },
    { id: 31, userId: 7, roleId: FINANCE.id },
    { id: 41, userId: 8, roleId: FINANCE.id },
    { id: 42, userId: 8, roleId: BILLING.id },
  ];

  it('HARD-deletes the role row (never a soft delete, so the (user, role) pair is free to grant again) and audits REVOKE_ROLE with the before/after role-id lists', async () => {
    const t = arrange(ROWS);

    await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, ROOT)).resolves.toBe(true);

    expect(t.txUserRoles.delete).toHaveBeenCalledWith({ userId: 5, roleId: FINANCE.id });
    expect(t.txUserRoles.softDelete).not.toHaveBeenCalled();
    expect(t.txUserRoles.softRemove).not.toHaveBeenCalled();
    expect(t.txUserRoles.remove).not.toHaveBeenCalled();
    expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id]);
    expect(t.audit.record).toHaveBeenCalledTimes(1);
    expect(t.audit.record).toHaveBeenCalledWith(
      {
        moduleName: 'user_roles',
        entityId: 5,
        action: 'REVOKE_ROLE',
        oldValue: { roleIds: [SUPER_ADMIN.id, FINANCE.id] },
        newValue: { roleIds: [SUPER_ADMIN.id] },
        performedBy: 99,
      },
      t.txManager,
    );
  });

  it('a role revoked this way can be granted again (the unique key is free)', async () => {
    const t = arrange(ROWS);

    await t.service.removeRoleFromUser(5, FINANCE.id, undefined, ROOT);
    await expect(t.service.addRolesToUser(5, [FINANCE.id], undefined, ROOT)).resolves.toEqual([FINANCE.id]);

    expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
  });

  it("locks the user's rows with pessimistic_write before it decides or writes anything", async () => {
    const t = arrange(ROWS);

    await t.service.removeRoleFromUser(5, FINANCE.id, undefined, ROOT);

    expect(t.lockQueries).toHaveLength(1);
    expect(t.lockQueries[0].setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(t.lockQueries[0].where).toHaveBeenCalledWith('ur.userId = :userId', { userId: 5 });
    expect(t.events).toEqual(['pessimistic_write:user', `delete:${FINANCE.id}`]);
  });

  it('does the lock, the checks, the delete and the audit row in ONE transaction', async () => {
    const t = arrange(ROWS);

    await t.service.removeRoleFromUser(5, FINANCE.id, undefined, ROOT);

    expect(t.transaction).toHaveBeenCalledTimes(1);
  });

  it('the delete and its audit row commit or roll back together: a failing audit insert leaves the role in place', async () => {
    const t = arrange(ROWS);
    t.audit.record.mockRejectedValueOnce(new Error('audit down'));

    await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, ROOT)).rejects.toThrow('audit down');

    expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
  });

  describe('idempotent no-op', () => {
    it('a role the user does not hold is a no-op: false, no delete, no audit row', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, OPERATIONS.id, undefined, ROOT)).resolves.toBe(false);

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
    });

    it('a role id that does not exist at all (nobody can hold it) is the same no-op', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, 4040, undefined, ROOT)).resolves.toBe(false);

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
    });

    it("stays allowed for the actor's own user — removing a role they do not hold changes nothing", async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, OPERATIONS.id, undefined, superAdmin(5))).resolves.toBe(false);
    });
  });

  describe('SUPER_ADMIN accounts may only be changed by a SUPER_ADMIN', () => {
    it("a non-SUPER_ADMIN actor cannot revoke an ordinary role from a SUPER_ADMIN's account — 403, nothing deleted or audited", async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, STAFF)).rejects.toThrow(ForbiddenException);
      await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
    });

    it('a non-SUPER_ADMIN actor cannot strip SUPER_ADMIN itself from its holder (a demotion/takeover path)', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

      expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
    });

    it('a non-SUPER_ADMIN actor may still revoke roles from an ordinary account', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(8, BILLING.id, undefined, STAFF)).resolves.toBe(true);

      expect(t.roleIdsOf(8)).toEqual([FINANCE.id]);
    });

    it("the holder check reads the user's roles inside the same transaction (not a snapshot the caller took earlier)", async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, STAFF)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

      expect(t.txUserRoles.find).toHaveBeenCalledWith({ where: { userId: 5 }, relations: { role: true } });
    });

    it('a SUPER_ADMIN actor needs no holder lookup at all', async () => {
      const t = arrange(ROWS);

      await t.service.removeRoleFromUser(5, FINANCE.id, undefined, ROOT);

      expect(t.txUserRoles.find).not.toHaveBeenCalled();
    });
  });

  describe('rule 1 — no self-change', () => {
    it("refuses to revoke a role from the actor's OWN user; nothing is deleted or audited", async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, superAdmin(5))).rejects.toThrow(ForbiddenException);
      await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, superAdmin(5))).rejects.toThrow(
        'You cannot change your own roles.',
      );

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
    });

    it("never blocks revoking from a DIFFERENT user's account", async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, superAdmin(6))).resolves.toBe(true);
    });

    it('for the system actor the self-change rule does not apply — the other rules still do', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, SYSTEM_ACTOR)).resolves.toBe(true);
      await expect(t.service.removeRoleFromUser(7, FINANCE.id, undefined, SYSTEM_ACTOR)).rejects.toThrow(
        'A user must hold at least one role.',
      );
    });
  });

  describe("rule 2 — a user's last role", () => {
    it('refuses to remove the only role a user has (login and JwtStrategy reject a role-less user — an instant lock-out)', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(7, FINANCE.id, undefined, ROOT)).rejects.toThrow(ForbiddenException);
      await expect(t.service.removeRoleFromUser(7, FINANCE.id, undefined, ROOT)).rejects.toThrow(
        'A user must hold at least one role.',
      );

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.roleIdsOf(7)).toEqual([FINANCE.id]);
    });

    it('allows removing one of several roles — the user keeps the rest', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(6, OPERATIONS.id, undefined, ROOT)).resolves.toBe(true);

      expect(t.roleIdsOf(6)).toEqual([SUPER_ADMIN.id]);
    });
  });

  describe('rule 3 — the last ACTIVE SUPER_ADMIN', () => {
    // User 6's SUPER_ADMIN row is gone: user 5 is now the ONLY holder (and still has a second role,
    // so rule 2 does not fire first).
    const SOLE_HOLDER_ROWS = ROWS.filter((r) => r.id !== 21);

    it('refuses to remove SUPER_ADMIN from the only user who holds it; nothing is deleted or audited', async () => {
      const t = arrange(SOLE_HOLDER_ROWS);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT)).rejects.toThrow(ForbiddenException);
      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT)).rejects.toThrow(LAST_SUPER_ADMIN_MESSAGE);

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
    });

    it('allows removing SUPER_ADMIN while another ACTIVE user also holds it', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT)).resolves.toBe(true);

      expect(t.roleIdsOf(5)).toEqual([FINANCE.id]);
      expect(t.roleIdsOf(6)).toEqual([SUPER_ADMIN.id, OPERATIONS.id]);
    });

    it('a DEACTIVATED second holder does not count: the remaining active SUPER_ADMIN is still the last one and cannot be demoted', async () => {
      const t = arrange(ROWS, { 6: { active: false } });

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT)).rejects.toThrow(LAST_SUPER_ADMIN_MESSAGE);

      expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
    });

    it('a SOFT-DELETED second holder does not count either', async () => {
      const t = arrange(ROWS, { 6: { deletedAt: new Date('2026-01-01') } });

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT)).rejects.toThrow(LAST_SUPER_ADMIN_MESSAGE);
    });

    it('removing SUPER_ADMIN from a deactivated holder is allowed while an active one remains — and even when they are the only holder, since a deactivated account is not an administrator anyone can use', async () => {
      const withActiveOther = arrange(ROWS, { 5: { active: false } });
      await expect(withActiveOther.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT)).resolves.toBe(true);

      const soleButInactive = arrange(SOLE_HOLDER_ROWS, { 5: { active: false } });
      await expect(soleButInactive.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT)).resolves.toBe(true);
    });

    it("locks the SUPER_ADMIN holders' rows with pessimistic_write, and BEFORE the user's own rows (so two admins demoting each other queue up on one lock instead of deadlocking)", async () => {
      const t = arrange(ROWS);

      await t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT);

      expect(t.lockQueries).toHaveLength(2);
      expect(t.lockQueries[0].setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(t.lockQueries[0].where).toHaveBeenCalledWith('ur.roleId = :roleId', { roleId: SUPER_ADMIN.id });
      expect(t.lockQueries[1].setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(t.lockQueries[1].where).toHaveBeenCalledWith('ur.userId = :userId', { userId: 5 });
      expect(t.events).toEqual(['pessimistic_write:role', 'pessimistic_write:user', `delete:${SUPER_ADMIN.id}`]);
    });

    it('the holder lock joins only ACTIVE, non-deleted users', async () => {
      const t = arrange(ROWS);

      await t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT);

      expect(t.lockQueries[0].innerJoin).toHaveBeenCalledWith(
        'ur.user',
        'user',
        'user.active = :active AND user.deletedAt IS NULL',
        { active: true },
      );
    });

    it('the check reads the rows under the lock, so once one removal has committed the other holder is refused — two removals can never both pass', async () => {
      // The outcome the lock guarantees: the second removal's locking read waits for the first
      // transaction and then sees its committed delete. Replayed here as the serialized sequence.
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT)).resolves.toBe(true);
      await expect(t.service.removeRoleFromUser(6, SUPER_ADMIN.id, undefined, ROOT)).rejects.toThrow(LAST_SUPER_ADMIN_MESSAGE);

      expect(t.roleIdsOf(6)).toEqual([SUPER_ADMIN.id, OPERATIONS.id]);
    });

    it('is checked after the last-role rule: a user whose ONLY role is the last SUPER_ADMIN is refused as a last role', async () => {
      const t = arrange([{ id: 11, userId: 5, roleId: SUPER_ADMIN.id }]);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, ROOT)).rejects.toThrow('A user must hold at least one role.');
    });

    it('is checked after the self-change rule, so removing your own last-SUPER_ADMIN role reports the self-change refusal', async () => {
      const t = arrange(SOLE_HOLDER_ROWS);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, superAdmin(5))).rejects.toThrow(
        'You cannot change your own roles.',
      );
    });

    it('revoking a role that is not SUPER_ADMIN takes no SUPER_ADMIN-holder lock at all', async () => {
      const t = arrange(ROWS);

      await t.service.removeRoleFromUser(6, OPERATIONS.id, undefined, ROOT);

      expect(t.events).toEqual(['pessimistic_write:user', `delete:${OPERATIONS.id}`]);
    });
  });

  it("joins the caller's transaction when one is passed: the same manager does the lock, the delete and the audit insert, and no transaction of its own is opened", async () => {
    const t = arrange(ROWS);

    await t.service.removeRoleFromUser(5, FINANCE.id, t.txManager as any, ROOT);

    expect(t.transaction).not.toHaveBeenCalled();
    expect(t.audit.record).toHaveBeenCalledWith(expect.any(Object), t.txManager);
  });
});

describe('UserRoleService — SUPER_ADMIN protection helpers (used by delete / deactivate / reset / sessions)', () => {
  // 5 and 6 hold SUPER_ADMIN, 8 holds only an ordinary role.
  const ROWS: Row[] = [
    { id: 11, userId: 5, roleId: SUPER_ADMIN.id },
    { id: 21, userId: 6, roleId: SUPER_ADMIN.id },
    { id: 41, userId: 8, roleId: FINANCE.id },
  ];

  describe('lockActiveSuperAdminHolders', () => {
    it('returns every ACTIVE, non-deleted holder, locked pessimistic_write', async () => {
      const t = arrange(ROWS);

      await expect(t.service.lockActiveSuperAdminHolders(t.txManager as any)).resolves.toEqual([5, 6]);

      expect(t.lockQueries[0].setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('leaves out a deactivated holder and a soft-deleted holder — neither is a usable administrator', async () => {
      const t = arrange(ROWS, { 5: { active: false }, 6: { deletedAt: new Date('2026-01-01') } });

      await expect(t.service.lockActiveSuperAdminHolders(t.txManager as any)).resolves.toEqual([]);
    });

    it('returns nothing (and takes no lock) when the SUPER_ADMIN role does not exist yet', async () => {
      const t = arrange(ROWS);
      t.txRoles.findOne.mockResolvedValueOnce(null);

      await expect(t.service.lockActiveSuperAdminHolders(t.txManager as any)).resolves.toEqual([]);

      expect(t.lockQueries).toHaveLength(0);
    });
  });

  describe('assertNotLastActiveSuperAdmin', () => {
    it('refuses (403, naming the action) when the user is the ONLY active SUPER_ADMIN', async () => {
      const t = arrange(ROWS, { 6: { active: false } });

      await expect(t.service.assertNotLastActiveSuperAdmin(5, t.txManager as any, 'delete')).rejects.toThrow(ForbiddenException);
      await expect(t.service.assertNotLastActiveSuperAdmin(5, t.txManager as any, 'deactivate')).rejects.toThrow(
        'Cannot deactivate the last active SUPER_ADMIN — at least one active user must hold this role.',
      );
    });

    it('passes while another ACTIVE SUPER_ADMIN exists', async () => {
      const t = arrange(ROWS);

      await expect(t.service.assertNotLastActiveSuperAdmin(5, t.txManager as any, 'delete')).resolves.toBeUndefined();
    });

    it('passes for a user who is not an active SUPER_ADMIN at all (an ordinary user, or an already-deactivated holder)', async () => {
      const ordinary = arrange(ROWS, { 6: { active: false } });
      await expect(ordinary.service.assertNotLastActiveSuperAdmin(8, ordinary.txManager as any, 'delete')).resolves.toBeUndefined();

      const alreadyInactive = arrange(ROWS, { 5: { active: false }, 6: { active: false } });
      await expect(alreadyInactive.service.assertNotLastActiveSuperAdmin(5, alreadyInactive.txManager as any, 'delete')).resolves.toBeUndefined();
    });
  });

  describe('assertActorMayModifyUser', () => {
    it('lets a SUPER_ADMIN and the system actor modify anyone, with no lookup', async () => {
      const t = arrange(ROWS);

      await expect(t.service.assertActorMayModifyUser(ROOT, 5, t.txManager as any)).resolves.toBeUndefined();
      await expect(t.service.assertActorMayModifyUser(SYSTEM_ACTOR, 5, t.txManager as any)).resolves.toBeUndefined();

      expect(t.txUserRoles.find).not.toHaveBeenCalled();
    });

    it("refuses a non-SUPER_ADMIN actor on a SUPER_ADMIN's account with 403", async () => {
      const t = arrange(ROWS);

      await expect(t.service.assertActorMayModifyUser(STAFF, 5, t.txManager as any)).rejects.toThrow(ForbiddenException);
      await expect(t.service.assertActorMayModifyUser(STAFF, 5, t.txManager as any)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);
    });

    it('lets a non-SUPER_ADMIN actor modify an ordinary account', async () => {
      const t = arrange(ROWS);

      await expect(t.service.assertActorMayModifyUser(STAFF, 8, t.txManager as any)).resolves.toBeUndefined();
    });
  });

  describe('holdsSuperAdmin / getRoleNamesForUser', () => {
    it('answers from the live role names, inside the given transaction', async () => {
      const t = arrange(ROWS);

      await expect(t.service.holdsSuperAdmin(5, t.txManager as any)).resolves.toBe(true);
      await expect(t.service.holdsSuperAdmin(8, t.txManager as any)).resolves.toBe(false);
      await expect(t.service.getRoleNamesForUser(8, t.txManager as any)).resolves.toEqual(['FINANCE']);
    });

    it('works without a transaction too (read through the repository manager)', async () => {
      const t = arrange(ROWS);

      await expect(t.service.holdsSuperAdmin(6)).resolves.toBe(true);
    });
  });
});

describe('UserRoleService read helpers', () => {
  function buildReadService(repo: Record<string, unknown>) {
    return new UserRoleService(repo as any, { record: jest.fn() } as any);
  }

  describe('getRolesForUser', () => {
    it('returns the Role entities in assignment order (the first is the primary)', async () => {
      const A = { id: 3, roleName: 'FINANCE' };
      const B = { id: 7, roleName: 'OPERATIONS' };
      const repo = {
        find: jest.fn().mockResolvedValue([
          { id: 1, userId: 5, roleId: 3, role: A },
          { id: 2, userId: 5, roleId: 7, role: B },
        ]),
      };

      const roles = await buildReadService(repo).getRolesForUser(5);

      expect(repo.find).toHaveBeenCalledWith({ where: { userId: 5 }, order: { id: 'ASC' }, relations: { role: true } });
      expect(roles).toEqual([A, B]);
    });

    it('skips an assignment whose role has since been soft-deleted (it joins to null) instead of returning a null entry', async () => {
      const A = { id: 3, roleName: 'FINANCE' };
      const repo = {
        find: jest.fn().mockResolvedValue([
          { id: 1, userId: 5, roleId: 9, role: null },
          { id: 2, userId: 5, roleId: 3, role: A },
        ]),
      };

      await expect(buildReadService(repo).getRolesForUser(5)).resolves.toEqual([A]);
    });
  });

  describe('getRoleRefsForUser (the per-request lookup JwtStrategy makes)', () => {
    it('joins only LIVE (not soft-deleted) roles, in assignment order, and returns numeric ids', async () => {
      const qb: any = {
        innerJoin: jest.fn(() => qb),
        where: jest.fn(() => qb),
        select: jest.fn(() => qb),
        addSelect: jest.fn(() => qb),
        orderBy: jest.fn(() => qb),
        getRawMany: jest.fn().mockResolvedValue([
          { id: '3', roleName: 'FINANCE' },
          { id: 7, roleName: 'OPERATIONS' },
        ]),
      };
      const repo = { createQueryBuilder: jest.fn(() => qb) };

      const refs = await buildReadService(repo).getRoleRefsForUser(5);

      expect(qb.innerJoin).toHaveBeenCalledWith(Role, 'role', 'role.id = ur.roleId AND role.deletedAt IS NULL');
      expect(qb.orderBy).toHaveBeenCalledWith('ur.id', 'ASC');
      expect(refs).toEqual([
        { id: 3, roleName: 'FINANCE' },
        { id: 7, roleName: 'OPERATIONS' },
      ]);
    });
  });

  describe('getUsersByRoleId', () => {
    function usersByRoleQuery(rows: Array<{ userId: string | number }>) {
      const qb: any = {
        innerJoin: jest.fn(() => qb),
        where: jest.fn(() => qb),
        select: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      return { qb, repo: { createQueryBuilder: jest.fn(() => qb) } };
    }

    it('counts every user that still exists, deactivated or not (role counts and the role-delete guard need them)', async () => {
      const { qb, repo } = usersByRoleQuery([{ userId: '4' }, { userId: 9 }]);

      await expect(buildReadService(repo).getUsersByRoleId(3)).resolves.toEqual([{ userId: 4 }, { userId: 9 }]);

      expect(qb.innerJoin).toHaveBeenCalledWith('ur.user', 'user', 'user.deletedAt IS NULL');
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('activeOnly additionally drops deactivated accounts (who to notify on an SLA breach)', async () => {
      const { qb, repo } = usersByRoleQuery([{ userId: 4 }]);

      await buildReadService(repo).getUsersByRoleId(3, true);

      expect(qb.andWhere).toHaveBeenCalledWith('user.active = :active', { active: true });
    });
  });

  describe('getRolesForUsers', () => {
    it("returns each user's roles keyed by user id, in assignment order, from ONE query", async () => {
      const A = { id: 3, roleName: 'FINANCE' };
      const B = { id: 7, roleName: 'OPERATIONS' };
      const C = { id: 9, roleName: 'BILLING' };
      const qb: any = {
        innerJoinAndSelect: jest.fn(() => qb),
        where: jest.fn(() => qb),
        orderBy: jest.fn(() => qb),
        // already ORDER BY ur.id: user 1 was granted A, then user 2 got B, then user 1 got C
        getMany: jest.fn().mockResolvedValue([
          { id: 1, userId: 1, roleId: 3, role: A },
          { id: 2, userId: 2, roleId: 7, role: B },
          { id: 3, userId: 1, roleId: 9, role: C },
        ]),
      };
      const repo = { createQueryBuilder: jest.fn(() => qb) };

      const result = await buildReadService(repo).getRolesForUsers([1, 2, 3]);

      expect(repo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(qb.where).toHaveBeenCalledWith('ur.userId IN (:...userIds)', { userIds: [1, 2, 3] });
      expect(qb.orderBy).toHaveBeenCalledWith('ur.id', 'ASC');
      expect(result.get(1)).toEqual([A, C]);
      expect(result.get(2)).toEqual([B]);
      expect(result.has(3)).toBe(false); // a user with no assignment is simply absent
    });

    it('does not query at all for an empty page', async () => {
      const repo = { createQueryBuilder: jest.fn() };

      const result = await buildReadService(repo).getRolesForUsers([]);

      expect(result.size).toBe(0);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('getUsersByRoleCapability', () => {
    it('orders rows by user_roles.id so a caller keeping the first row per user gets the first-assigned qualifying role', async () => {
      const qb: any = {
        innerJoin: jest.fn(() => qb),
        where: jest.fn(() => qb),
        select: jest.fn(() => qb),
        addSelect: jest.fn(() => qb),
        orderBy: jest.fn(() => qb),
        getRawMany: jest.fn().mockResolvedValue([
          { userId: '4', roleId: '13', roleName: 'FINANCE' },
          { userId: '4', roleId: '17', roleName: 'OPERATIONS' },
        ]),
      };
      const repo = { createQueryBuilder: jest.fn(() => qb) };

      const rows = await buildReadService(repo).getUsersByRoleCapability('canBeReportingManager');

      expect(qb.orderBy).toHaveBeenCalledWith('ur.id', 'ASC');
      expect(rows).toEqual([
        { userId: 4, roleId: 13, roleName: 'FINANCE' },
        { userId: 4, roleId: 17, roleName: 'OPERATIONS' },
      ]);
    });
  });
});
