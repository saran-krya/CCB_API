import { UserService } from './user.service';

// Users list has ONE search box (matching Role Management's own single-search layout) instead of four
// independent AND'd filters (search.fullName/search.email/search.mobile/search.role) — this suite proves
// UserService.findAll builds exactly one OR'd condition across name/email/mobile/ANY of the user's role
// names when a search term is given, and no filter condition at all when it's empty, against the REAL
// query-building code path (not a hand-copied assumption about what SQL it emits).
//
// A user may hold several roles, and the list must still page and count USERS: the paginated query
// therefore never joins user_roles (a join would return one row per role and skip/take would count
// rows), and every page's roles arrive through one batched lookup instead. The real TypeORM SQL for
// both queries is database-side behavior a stub cannot execute, so these tests pin the property that
// makes it correct — no join on the paginated query, role matching via EXISTS — and the response
// mapping.
describe('UserService.findAll — single combined search (name OR email OR mobile OR any role) over multi-role users', () => {
  let andWhereCalls: { sql: string; params?: Record<string, unknown> }[];
  let joinCalls: string[];
  let orderByCalls: { column: string; order?: string }[];
  let addSelectCalls: { sql: string; alias?: string }[];
  let page: { items: any[]; total: number };
  let usersRepo: { createQueryBuilder: jest.Mock };
  let userRoleService: { getRolesForUsers: jest.Mock };
  let service: UserService;

  const FINANCE = { id: 4, roleName: 'FINANCE', roleDescription: 'Finance team', canBeReportingManager: true };
  const OPERATIONS = { id: 3, roleName: 'OPERATIONS', roleDescription: 'Operations', canBeReportingManager: true };
  const BILLING = { id: 9, roleName: 'BILLING', roleDescription: null, canBeReportingManager: false };

  function makeQueryBuilderStub() {
    const qb: any = {
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        andWhereCalls.push({ sql, params });
        return qb;
      },
      orderBy: (column: string, order?: string) => {
        orderByCalls.push({ column, order });
        return qb;
      },
      addSelect: (sql: string, alias?: string) => {
        addSelectCalls.push({ sql, alias });
        return qb;
      },
      skip: () => qb,
      take: () => qb,
      getManyAndCount: async () => [page.items, page.total],
    };
    // Every join flavour is recorded so a test can prove the paginated query uses none of them.
    for (const join of ['leftJoin', 'innerJoin', 'leftJoinAndSelect', 'innerJoinAndSelect', 'leftJoinAndMapOne', 'leftJoinAndMapMany']) {
      qb[join] = () => {
        joinCalls.push(join);
        return qb;
      };
    }
    return qb;
  }

  beforeEach(() => {
    andWhereCalls = [];
    joinCalls = [];
    orderByCalls = [];
    addSelectCalls = [];
    page = { items: [], total: 0 };
    usersRepo = { createQueryBuilder: jest.fn().mockImplementation(() => makeQueryBuilderStub()) };
    userRoleService = { getRolesForUsers: jest.fn().mockResolvedValue(new Map()) };
    service = new UserService(
      usersRepo as any,
      {} as any, // RolePermissionsService — unused by findAll
      {} as any, // RoleService
      {} as any, // AuditService
      {} as any, // AttributeService
      {} as any, // LovService
      userRoleService as any, // UserRoleService
    );
  });

  describe('search', () => {
    it('adds no filter condition at all when search.query is empty', async () => {
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC' } as any);
      expect(andWhereCalls).toHaveLength(0);
    });

    it("adds exactly one OR'd condition covering name, email, mobile and ANY role when search.query is given", async () => {
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', ['search.query']: 'john' } as any);
      expect(andWhereCalls).toHaveLength(1);
      const [{ sql, params }] = andWhereCalls;
      expect(sql).toContain('LIKE :term');
      expect(sql).toMatch(/OR\s+user\.email LIKE :term/);
      expect(sql).toMatch(/OR\s+user\.mobile LIKE :term/);
      expect(params).toEqual({ term: '%john%' });
    });

    it("matches a role through EXISTS over the user's live assignments — any one matching role is enough, and no row is multiplied", async () => {
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', ['search.query']: 'fin' } as any);
      const [{ sql }] = andWhereCalls;
      expect(sql).toMatch(/OR\s+EXISTS\s*\(/);
      expect(sql).toMatch(/FROM\s+user_roles\s+ur/);
      expect(sql).toMatch(/ur\.user_id\s*=\s*user\.id/);
      expect(sql).toMatch(/ur\.deleted_at IS NULL/);
      expect(sql).toMatch(/r\.deleted_at IS NULL/);
      expect(sql).toMatch(/r\.role_name LIKE :term/);
      // the old single-role predicate over a joined `role` alias must be gone
      expect(sql).not.toMatch(/role\.roleName/);
    });

    it("uses one shared :term for every leg, so the role leg searches exactly what the name/email/mobile legs do", async () => {
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', ['search.query']: 'fin' } as any);
      const [{ sql }] = andWhereCalls;
      expect(sql.match(/:term/g)).toHaveLength(4);
    });
  });

  describe('paging and counting users, not role rows', () => {
    it('never joins user_roles (or anything else) on the paginated query — one row per user by construction, so skip/take and the total count users', async () => {
      page = { items: [{ id: 1, firstName: 'A' }], total: 1 };

      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', ['search.query']: 'fin' } as any);

      expect(joinCalls).toEqual([]);
    });

    it('a user holding several roles is ONE item, and the total is the distinct-user total the query reported', async () => {
      // 25 users in all, this page holds 2 of them; user 1 holds three roles.
      page = {
        items: [
          { id: 1, firstName: 'Multi', lastName: 'Role' },
          { id: 2, firstName: 'Single', lastName: 'Role' },
        ],
        total: 25,
      };
      userRoleService.getRolesForUsers.mockResolvedValue(
        new Map([
          [1, [OPERATIONS, FINANCE, BILLING]],
          [2, [FINANCE]],
        ]),
      );

      const result = await service.findAll({ page: 1, limit: 2, sortOrder: 'DESC' } as any);

      expect(result.items).toHaveLength(2);
      expect(result.items.map((u) => u.id)).toEqual([1, 2]);
      expect(result.pagination).toEqual({ page: 1, limit: 2, total: 25, totalPages: 13 });
    });
  });

  describe('response mapping', () => {
    it("keeps `role` as the PRIMARY (first assigned, the full Role as before) and adds `roles` — every role as { id, roleName }, in assignment order — beside every existing field", async () => {
      page = {
        items: [{ id: 1, firstName: 'Multi', middleName: 'M', lastName: 'Role', email: 'multi@example.com', active: true }],
        total: 1,
      };
      userRoleService.getRolesForUsers.mockResolvedValue(new Map([[1, [OPERATIONS, FINANCE, BILLING]]]));

      const result = await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC' } as any);

      expect(result.items[0]).toEqual({
        id: 1,
        firstName: 'Multi',
        middleName: 'M',
        lastName: 'Role',
        email: 'multi@example.com',
        active: true,
        fullName: 'Multi M Role',
        role: OPERATIONS,
        roles: [
          { id: 3, roleName: 'OPERATIONS' },
          { id: 4, roleName: 'FINANCE' },
          { id: 9, roleName: 'BILLING' },
        ],
      });
    });

    it('a user with no role assignment gets role: null and roles: []', async () => {
      page = { items: [{ id: 7, firstName: 'No', lastName: 'Role' }], total: 1 };

      const result = await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC' } as any);

      expect(result.items[0]).toMatchObject({ id: 7, fullName: 'No Role', role: null, roles: [] });
    });

    it("looks up the page's roles in ONE batched query for exactly the users on the page — a role search never narrows a user's roles in the response", async () => {
      page = { items: [{ id: 1, firstName: 'A', lastName: 'B' }, { id: 2, firstName: 'C', lastName: 'D' }], total: 2 };

      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', ['search.query']: 'fin' } as any);

      expect(userRoleService.getRolesForUsers).toHaveBeenCalledTimes(1);
      expect(userRoleService.getRolesForUsers).toHaveBeenCalledWith([1, 2]);
    });

    it('does not look up roles at all for an empty page', async () => {
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', ['search.query']: 'nobody' } as any);

      expect(userRoleService.getRolesForUsers).not.toHaveBeenCalled();
    });
  });

  describe('filters and sort', () => {
    it('adds no filter condition for status / roleId when they are not given', async () => {
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC' } as any);
      expect(andWhereCalls).toHaveLength(0);
    });

    it('filters by status through the active column', async () => {
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', status: 'inactive' } as any);
      expect(andWhereCalls).toEqual([{ sql: 'user.active = :active', params: { active: false } }]);

      andWhereCalls.length = 0;
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', status: 'active' } as any);
      expect(andWhereCalls[0].params).toEqual({ active: true });
    });

    it('filters by role with an EXISTS, never a join (so the page still holds one row per user)', async () => {
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', roleId: 4 } as any);
      expect(andWhereCalls).toHaveLength(1);
      expect(andWhereCalls[0].sql).toContain('EXISTS');
      expect(andWhereCalls[0].sql).toContain('ur_filter.role_id = :filterRoleId');
      expect(andWhereCalls[0].params).toEqual({ filterRoleId: 4 });
      expect(joinCalls).toHaveLength(0);
    });

    it("sorts by the user's primary role name through a selected alias, not a join", async () => {
      await service.findAll({ page: 1, limit: 10, sortOrder: 'ASC', sortBy: 'roles' } as any);
      expect(addSelectCalls).toHaveLength(1);
      expect(addSelectCalls[0].alias).toBe('primary_role_name');
      expect(addSelectCalls[0].sql).toContain('ORDER BY ur_sort.id ASC');
      expect(orderByCalls).toEqual([{ column: 'primary_role_name', order: 'ASC' }]);
      expect(joinCalls).toHaveLength(0);
    });

    it('sorts by status through the active column, and falls back to createdAt for an unknown key', async () => {
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', sortBy: 'active' } as any);
      expect(orderByCalls[0]).toEqual({ column: 'user.active', order: 'DESC' });

      orderByCalls.length = 0;
      await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', sortBy: 'passwordHash' } as any);
      expect(orderByCalls[0].column).toBe('user.createdAt');
      expect(addSelectCalls).toHaveLength(0);
    });
  });
});
