import { ForbiddenException } from '@nestjs/common';
import { UserRoleService } from './user-role.service';
import { UserRole } from './entities/user-role.entity';
import { Role } from '../role/entities/role.entity';

// Isolated unit tests for UserRoleService's write paths — the multi-role assignment model: a user holds
// MANY roles, roles are only ever added (idempotently) or revoked one at a time, and the three business
// rules on revoking (no self-change, last role, last SUPER_ADMIN) are enforced in the same transaction
// as the delete, against rows locked with pessimistic_write. No real database connection: the table is
// an in-memory stand-in behind exactly the repository/manager surface the service touches (see
// `arrange`), which is enough to prove WHAT is written, WHEN each lock is taken and that a failure
// rolls the whole unit of work back — true lock contention is a database property and cannot be
// exercised by a mock, so the concurrency tests below assert the lock calls and their ORDER instead.

interface Row {
  id: number;
  userId: number;
  roleId: number;
}

const SUPER_ADMIN = { id: 1, roleName: 'SUPER_ADMIN' };
const FINANCE = { id: 3, roleName: 'FINANCE' };
const OPERATIONS = { id: 7, roleName: 'OPERATIONS' };
const BILLING = { id: 9, roleName: 'BILLING' };
const ROLE_TABLE = [SUPER_ADMIN, FINANCE, OPERATIONS, BILLING];

const LAST_SUPER_ADMIN_MESSAGE = 'Cannot remove the last SUPER_ADMIN — at least one user must hold this role.';

function arrange(initialRows: Row[]) {
  let rows: Row[] = initialRows.map((r) => ({ ...r }));
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
  // Ordered log of every lock and write, so a test can assert what happened BEFORE what.
  const events: string[] = [];
  const byId = (a: Row, b: Row) => a.id - b.id;

  // A locking read always sees the latest committed rows, so it reads the live table, and it records
  // the lock mode plus whether it scanned one user's rows or one role's holders.
  const lockQueries: any[] = [];
  const lockQuery = () => {
    let mode = '';
    let params: { userId?: number; roleId?: number } = {};
    const qb: any = {
      setLock: jest.fn((m: string) => {
        mode = m;
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
          .sort(byId)
          .map((r) => ({ ...r }));
      }),
    };
    lockQueries.push(qb);
    return qb;
  };

  const txUserRoles = {
    find: jest.fn(async ({ where }: { where: { userId: number } }) =>
      rows
        .filter((r) => r.userId === where.userId)
        .sort(byId)
        .map((r) => ({ ...r })),
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
    findOne: jest.fn(async ({ where }: { where: { id: number } }) => ROLE_TABLE.find((r) => r.id === where.id) ?? null),
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
  const plainRepo = { manager: { transaction } };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new UserRoleService(plainRepo as any, audit as any);

  return {
    service,
    audit,
    txManager,
    txUserRoles,
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

    const added = await t.service.addRolesToUser(55, [BILLING.id, FINANCE.id, OPERATIONS.id], undefined, 11);

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

    await t.service.addRolesToUser(77, [OPERATIONS.id, FINANCE.id, BILLING.id], t.txManager as any, 11);

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

    await t.service.addRolesToUser(55, [BILLING.id, OPERATIONS.id], undefined, 11);

    expect(t.transaction).toHaveBeenCalledTimes(1);
  });

  it('skips ids the user already holds — a request that changes nothing writes nothing and audits nothing', async () => {
    const t = arrange(ROWS);

    const added = await t.service.addRolesToUser(55, [FINANCE.id], undefined, 11);

    expect(added).toEqual([]);
    expect(t.txUserRoles.save).not.toHaveBeenCalled();
    expect(t.audit.record).not.toHaveBeenCalled();
    expect(t.roleIdsOf(55)).toEqual([FINANCE.id]);
  });

  it('is idempotent: repeating the same request the second time is a no-op with no second audit row', async () => {
    const t = arrange(ROWS);

    expect(await t.service.addRolesToUser(55, [BILLING.id], undefined, 11)).toEqual([BILLING.id]);
    expect(await t.service.addRolesToUser(55, [BILLING.id], undefined, 11)).toEqual([]);

    expect(t.roleIdsOf(55)).toEqual([FINANCE.id, BILLING.id]);
    expect(t.audit.record).toHaveBeenCalledTimes(1);
  });

  it('grants a role id repeated within one request only once', async () => {
    const t = arrange(ROWS);

    const added = await t.service.addRolesToUser(55, [BILLING.id, BILLING.id], undefined, 11);

    expect(added).toEqual([BILLING.id]);
    expect(t.txUserRoles.save).toHaveBeenCalledTimes(1);
  });

  it('only ever ADDS — it never deletes or replaces anything a user already holds (what makes the boot-time seed safe)', async () => {
    const t = arrange([
      { id: 1, userId: 55, roleId: FINANCE.id },
      { id: 2, userId: 55, roleId: OPERATIONS.id },
    ]);

    await t.service.addRolesToUser(55, [SUPER_ADMIN.id]); // no manager, no actor — exactly the seed's call shape

    expect(t.roleIdsOf(55)).toEqual([FINANCE.id, OPERATIONS.id, SUPER_ADMIN.id]);
    expect(t.txUserRoles.delete).not.toHaveBeenCalled();
    expect(t.txUserRoles.softDelete).not.toHaveBeenCalled();
    expect(t.txUserRoles.remove).not.toHaveBeenCalled();
  });

  it('with no actor (boot-time seeding) it still audits, with performedBy left undefined for AuditService to null', async () => {
    const t = arrange([{ id: 1, userId: 1, roleId: FINANCE.id }]);

    await t.service.addRolesToUser(1, [SUPER_ADMIN.id]);

    expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ASSIGN_ROLE', performedBy: undefined }), t.txManager);
  });

  it("joins the caller's transaction when one is passed: the same manager does the write and the audit insert, and no transaction of its own is opened", async () => {
    const t = arrange(ROWS);

    await t.service.addRolesToUser(55, [BILLING.id], t.txManager as any, 11);

    expect(t.transaction).not.toHaveBeenCalled();
    expect(t.txManager.getRepository).toHaveBeenCalledWith(UserRole);
    expect(t.audit.record).toHaveBeenCalledWith(expect.any(Object), t.txManager);
  });

  it('an empty request does nothing at all — not even a transaction', async () => {
    const t = arrange(ROWS);

    expect(await t.service.addRolesToUser(55, [], undefined, 11)).toEqual([]);

    expect(t.transaction).not.toHaveBeenCalled();
    expect(t.audit.record).not.toHaveBeenCalled();
  });

  it('the grant and its audit row commit or roll back together: a failing audit insert leaves no role behind', async () => {
    const t = arrange(ROWS);
    t.audit.record.mockRejectedValueOnce(new Error('audit down'));

    await expect(t.service.addRolesToUser(55, [BILLING.id, OPERATIONS.id], undefined, 11)).rejects.toThrow('audit down');

    expect(t.roleIdsOf(55)).toEqual([FINANCE.id]);
  });

  describe('self-change rule', () => {
    it('refuses to grant roles to the actor\'s OWN user — nothing is written, nothing audited', async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [OPERATIONS.id], undefined, 55)).rejects.toThrow(ForbiddenException);
      await expect(t.service.addRolesToUser(55, [OPERATIONS.id], undefined, 55)).rejects.toThrow(
        'You cannot change your own roles.',
      );

      expect(t.txUserRoles.save).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.roleIdsOf(55)).toEqual([FINANCE.id]);
    });

    it('a request by the actor on their own user that would change nothing is a no-op and stays allowed', async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [FINANCE.id], undefined, 55)).resolves.toEqual([]);

      expect(t.audit.record).not.toHaveBeenCalled();
    });

    it("never blocks granting roles to a DIFFERENT user's account", async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [OPERATIONS.id], undefined, 99)).resolves.toEqual([OPERATIONS.id]);
    });

    it('decides "does this change anything" from the rows it reads inside its own transaction, never from anything the caller supplies', async () => {
      const t = arrange(ROWS);

      await expect(t.service.addRolesToUser(55, [OPERATIONS.id], undefined, 55)).rejects.toThrow(ForbiddenException);

      expect(t.txUserRoles.find).toHaveBeenCalledWith({ where: { userId: 55 }, order: { id: 'ASC' } });
    });
  });

  describe('concurrent identical grants (a double-submit racing past the read)', () => {
    const duplicateKey = () =>
      Object.assign(new Error("Duplicate entry '55-9' for key 'IDX_23ed6f04fe43066df08379fd03'"), { code: 'ER_DUP_ENTRY' });

    it('a duplicate-key error on insert means the role IS held now: no error, not reported as added, no audit', async () => {
      const t = arrange(ROWS);
      t.txUserRoles.save.mockRejectedValueOnce(duplicateKey());

      await expect(t.service.addRolesToUser(55, [BILLING.id], undefined, 11)).resolves.toEqual([]);

      expect(t.audit.record).not.toHaveBeenCalled();
    });

    it('only the roles this call really inserted are reported and audited when one of several collides', async () => {
      const t = arrange(ROWS);
      t.txUserRoles.save.mockRejectedValueOnce(duplicateKey());

      const added = await t.service.addRolesToUser(55, [BILLING.id, OPERATIONS.id], undefined, 11);

      expect(added).toEqual([OPERATIONS.id]);
      expect(t.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ newValue: { roleIds: [FINANCE.id, OPERATIONS.id] } }),
        t.txManager,
      );
    });

    it('any other database error is not swallowed', async () => {
      const t = arrange(ROWS);
      t.txUserRoles.save.mockRejectedValueOnce(Object.assign(new Error('Cannot add or update a child row'), { code: 'ER_NO_REFERENCED_ROW_2' }));

      await expect(t.service.addRolesToUser(55, [BILLING.id], undefined, 11)).rejects.toThrow('Cannot add or update a child row');

      expect(t.audit.record).not.toHaveBeenCalled();
    });
  });
});

describe('UserRoleService.removeRoleFromUser', () => {
  // User 5 holds SUPER_ADMIN (assigned first) and FINANCE; user 6 holds SUPER_ADMIN and OPERATIONS;
  // user 7 holds only FINANCE.
  const ROWS: Row[] = [
    { id: 11, userId: 5, roleId: SUPER_ADMIN.id },
    { id: 12, userId: 5, roleId: FINANCE.id },
    { id: 21, userId: 6, roleId: SUPER_ADMIN.id },
    { id: 22, userId: 6, roleId: OPERATIONS.id },
    { id: 31, userId: 7, roleId: FINANCE.id },
  ];

  it('HARD-deletes the role row (never a soft delete, so the (user, role) pair is free to grant again) and audits REVOKE_ROLE with the before/after role-id lists', async () => {
    const t = arrange(ROWS);

    await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, 99)).resolves.toBe(true);

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

    await t.service.removeRoleFromUser(5, FINANCE.id, undefined, 99);
    await expect(t.service.addRolesToUser(5, [FINANCE.id], undefined, 99)).resolves.toEqual([FINANCE.id]);

    expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
  });

  it("locks the user's rows with pessimistic_write before it decides or writes anything", async () => {
    const t = arrange(ROWS);

    await t.service.removeRoleFromUser(5, FINANCE.id, undefined, 99);

    expect(t.lockQueries).toHaveLength(1);
    expect(t.lockQueries[0].setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(t.lockQueries[0].where).toHaveBeenCalledWith('ur.userId = :userId', { userId: 5 });
    expect(t.events).toEqual(['pessimistic_write:user', `delete:${FINANCE.id}`]);
  });

  it('does the lock, the checks, the delete and the audit row in ONE transaction', async () => {
    const t = arrange(ROWS);

    await t.service.removeRoleFromUser(5, FINANCE.id, undefined, 99);

    expect(t.transaction).toHaveBeenCalledTimes(1);
  });

  it('the delete and its audit row commit or roll back together: a failing audit insert leaves the role in place', async () => {
    const t = arrange(ROWS);
    t.audit.record.mockRejectedValueOnce(new Error('audit down'));

    await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, 99)).rejects.toThrow('audit down');

    expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
  });

  describe('idempotent no-op', () => {
    it('a role the user does not hold is a no-op: false, no delete, no audit row', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, OPERATIONS.id, undefined, 99)).resolves.toBe(false);

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
    });

    it('a role id that does not exist at all (nobody can hold it) is the same no-op', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, 4040, undefined, 99)).resolves.toBe(false);

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
    });

    it("stays allowed for the actor's own user — removing a role they do not hold changes nothing", async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, OPERATIONS.id, undefined, 5)).resolves.toBe(false);
    });
  });

  describe('rule 1 — no self-change', () => {
    it("refuses to revoke a role from the actor's OWN user; nothing is deleted or audited", async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, 5)).rejects.toThrow(ForbiddenException);
      await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, 5)).rejects.toThrow('You cannot change your own roles.');

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
    });

    it("never blocks revoking from a DIFFERENT user's account", async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, FINANCE.id, undefined, 6)).resolves.toBe(true);
    });

    it('with no actor (a system caller) the self-change rule does not apply — the other two still do', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, FINANCE.id)).resolves.toBe(true);
      await expect(t.service.removeRoleFromUser(7, FINANCE.id)).rejects.toThrow('A user must hold at least one role.');
    });
  });

  describe("rule 2 — a user's last role", () => {
    it('refuses to remove the only role a user has (login and JwtStrategy reject a role-less user — an instant lock-out)', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(7, FINANCE.id, undefined, 99)).rejects.toThrow(ForbiddenException);
      await expect(t.service.removeRoleFromUser(7, FINANCE.id, undefined, 99)).rejects.toThrow(
        'A user must hold at least one role.',
      );

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.roleIdsOf(7)).toEqual([FINANCE.id]);
    });

    it('allows removing one of several roles — the user keeps the rest', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(6, OPERATIONS.id, undefined, 99)).resolves.toBe(true);

      expect(t.roleIdsOf(6)).toEqual([SUPER_ADMIN.id]);
    });
  });

  describe('rule 3 — the last SUPER_ADMIN', () => {
    // User 6's SUPER_ADMIN row is gone: user 5 is now the ONLY holder (and still has a second role,
    // so rule 2 does not fire first).
    const SOLE_HOLDER_ROWS = ROWS.filter((r) => r.id !== 21);

    it('refuses to remove SUPER_ADMIN from the only user who holds it; nothing is deleted or audited', async () => {
      const t = arrange(SOLE_HOLDER_ROWS);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, 99)).rejects.toThrow(ForbiddenException);
      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, 99)).rejects.toThrow(LAST_SUPER_ADMIN_MESSAGE);

      expect(t.txUserRoles.delete).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
      expect(t.roleIdsOf(5)).toEqual([SUPER_ADMIN.id, FINANCE.id]);
    });

    it('allows removing SUPER_ADMIN while another user also holds it', async () => {
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, 99)).resolves.toBe(true);

      expect(t.roleIdsOf(5)).toEqual([FINANCE.id]);
      expect(t.roleIdsOf(6)).toEqual([SUPER_ADMIN.id, OPERATIONS.id]);
    });

    it("locks the SUPER_ADMIN holders' rows with pessimistic_write, and BEFORE the user's own rows (so two admins demoting each other queue up on one lock instead of deadlocking)", async () => {
      const t = arrange(ROWS);

      await t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, 99);

      expect(t.lockQueries).toHaveLength(2);
      expect(t.lockQueries[0].setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(t.lockQueries[0].where).toHaveBeenCalledWith('ur.roleId = :roleId', { roleId: SUPER_ADMIN.id });
      expect(t.lockQueries[1].setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(t.lockQueries[1].where).toHaveBeenCalledWith('ur.userId = :userId', { userId: 5 });
      expect(t.events).toEqual(['pessimistic_write:role', 'pessimistic_write:user', `delete:${SUPER_ADMIN.id}`]);
    });

    it('the check reads the rows under the lock, so once one removal has committed the other holder is refused — two removals can never both pass', async () => {
      // The outcome the lock guarantees: the second removal's locking read waits for the first
      // transaction and then sees its committed delete. Replayed here as the serialized sequence.
      const t = arrange(ROWS);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, 99)).resolves.toBe(true);
      await expect(t.service.removeRoleFromUser(6, SUPER_ADMIN.id, undefined, 99)).rejects.toThrow(LAST_SUPER_ADMIN_MESSAGE);

      expect(t.roleIdsOf(6)).toEqual([SUPER_ADMIN.id, OPERATIONS.id]);
    });

    it('is checked after the last-role rule: a user whose ONLY role is the last SUPER_ADMIN is refused as a last role', async () => {
      const t = arrange([{ id: 11, userId: 5, roleId: SUPER_ADMIN.id }]);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, 99)).rejects.toThrow('A user must hold at least one role.');
    });

    it('is checked after the self-change rule, so removing your own last-SUPER_ADMIN role reports the self-change refusal', async () => {
      const t = arrange(SOLE_HOLDER_ROWS);

      await expect(t.service.removeRoleFromUser(5, SUPER_ADMIN.id, undefined, 5)).rejects.toThrow('You cannot change your own roles.');
    });

    it('revoking a role that is not SUPER_ADMIN takes no SUPER_ADMIN-holder lock at all', async () => {
      const t = arrange(ROWS);

      await t.service.removeRoleFromUser(6, OPERATIONS.id, undefined, 99);

      expect(t.events).toEqual(['pessimistic_write:user', `delete:${OPERATIONS.id}`]);
    });
  });

  it("joins the caller's transaction when one is passed: the same manager does the lock, the delete and the audit insert, and no transaction of its own is opened", async () => {
    const t = arrange(ROWS);

    await t.service.removeRoleFromUser(5, FINANCE.id, t.txManager as any, 99);

    expect(t.transaction).not.toHaveBeenCalled();
    expect(t.audit.record).toHaveBeenCalledWith(expect.any(Object), t.txManager);
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
