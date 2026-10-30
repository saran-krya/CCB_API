import { ROLES } from '@app/common/constants/global';
import { RoleService } from './role.service';

// The Roles list is searched, filtered, sorted and paged by the API, which also decides per row whether the
// role is the system role and whether it may be deleted — the web client works none of that out itself.
describe('RoleService.RoleLists — server-driven search / filter / sort', () => {
  let service: RoleService;
  let andWhereCalls: { sql: string; params?: Record<string, unknown> }[];
  let orderByCalls: { column: string; order?: string }[];
  let addOrderByCalls: { column: string; order?: string }[];
  let addSelectCalls: { sql: string; alias?: string }[];
  let page: { items: any[]; total: number };
  let userCounts: Map<number, number>;
  let policyCountRows: { roleId: number; count: string }[];
  let dataSource: { query: jest.Mock };

  const role = (id: number, roleName: string, label = 'Internal') => ({
    id,
    roleName,
    roleDescription: null,
    userCategoryId: 1,
    userCategory: { label },
    createdAt: new Date('2026-01-01'),
  });

  beforeEach(() => {
    andWhereCalls = [];
    orderByCalls = [];
    addOrderByCalls = [];
    addSelectCalls = [];
    page = { items: [], total: 0 };
    userCounts = new Map();
    policyCountRows = [];
    dataSource = { query: jest.fn().mockImplementation(async () => policyCountRows) };

    const qb: any = {
      leftJoinAndSelect: () => qb,
      addSelect: (sql: string, alias?: string) => {
        addSelectCalls.push({ sql, alias });
        return qb;
      },
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        andWhereCalls.push({ sql, params });
        return qb;
      },
      orderBy: (column: string, order?: string) => {
        orderByCalls.push({ column, order });
        return qb;
      },
      addOrderBy: (column: string, order?: string) => {
        addOrderByCalls.push({ column, order });
        return qb;
      },
      skip: () => qb,
      take: () => qb,
      getManyAndCount: async () => [page.items, page.total],
    };

    service = new RoleService(
      { createQueryBuilder: () => qb } as any,
      {
        findByCategory: jest.fn().mockResolvedValue([
          { id: 2, label: 'External' },
          { id: 1, label: 'Internal' },
        ]),
      } as any,
      {} as any,
      { getUserCountsByRoleIds: jest.fn().mockImplementation(async () => userCounts) } as any,
      dataSource as any,
    );
  });

  const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, sortOrder: 'DESC', ...over }) as any;

  it('adds no filter condition when nothing is searched or filtered', async () => {
    await service.RoleLists(q());
    expect(andWhereCalls).toHaveLength(0);
  });

  it('one search term matches the name, description OR user category', async () => {
    await service.RoleLists(q({ 'search.query': ' fin ' }));
    expect(andWhereCalls).toHaveLength(1);
    expect(andWhereCalls[0].sql).toContain('role.roleName LIKE :term');
    expect(andWhereCalls[0].sql).toContain('role.roleDescription LIKE :term');
    expect(andWhereCalls[0].sql).toContain('userCategory.label LIKE :term');
    expect(andWhereCalls[0].params).toEqual({ term: '%fin%' });
  });

  it('filters by user category and by created date', async () => {
    await service.RoleLists(q({ userCategoryId: 2, 'search.createdAt': '2026-06-25' }));
    expect(andWhereCalls.map((c) => c.params)).toEqual([{ userCategoryId: 2 }, { createdAt: '2026-06-25' }]);
  });

  it('sorts count columns through selected aliases, never a join', async () => {
    await service.RoleLists(q({ sortBy: 'assignedUserCount', sortOrder: 'ASC' }));
    expect(orderByCalls).toEqual([{ column: 'assigned_user_count', order: 'ASC' }]);
    expect(addOrderByCalls).toEqual([{ column: 'role.roleName', order: 'ASC' }]);
    expect(addSelectCalls.map((s) => s.alias)).toEqual(['assigned_user_count', 'policy_count']);

    orderByCalls.length = 0;
    await service.RoleLists(q({ sortBy: 'policyCount' }));
    expect(orderByCalls[0]).toEqual({ column: 'policy_count', order: 'DESC' });
  });

  it('sorts by name / category, and falls back to created date for an unknown key', async () => {
    await service.RoleLists(q({ sortBy: 'roleName', sortOrder: 'ASC' }));
    expect(orderByCalls[0]).toEqual({ column: 'role.roleName', order: 'ASC' });
    expect(addOrderByCalls).toHaveLength(0);

    orderByCalls.length = 0;
    await service.RoleLists(q({ sortBy: 'userCategory' }));
    expect(orderByCalls[0].column).toBe('userCategory.label');

    orderByCalls.length = 0;
    await service.RoleLists(q({ sortBy: 'passwordHash' }));
    expect(orderByCalls[0].column).toBe('role.createdAt');
  });

  it('flags the system role and says why a role cannot be deleted', async () => {
    page = { items: [role(1, ROLES.SUPER_ADMIN), role(2, 'FINANCE'), role(3, 'EMPTY')], total: 3 };
    userCounts = new Map([[2, 3]]);

    const { items } = await service.RoleLists(q());

    expect(items.map((r) => [r.roleName, r.isSystem])).toEqual([
      [ROLES.SUPER_ADMIN, true],
      ['FINANCE', false],
      ['EMPTY', false],
    ]);
    expect(items[0].deleteBlockedReason).toMatch(/system role/);
    expect(items[1].deleteBlockedReason).toMatch(/Assigned to 3 users/);
    expect(items[2].deleteBlockedReason).toBeNull();
  });

  it("reports each role's policy count from ONE grouped query (0 when none)", async () => {
    page = { items: [role(1, 'A'), role(2, 'B')], total: 2 };
    policyCountRows = [{ roleId: 1, count: '2' }];

    const { items } = await service.RoleLists(q());

    expect(items.map((r) => r.policyCount)).toEqual([2, 0]);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  it('returns the User Category filter options (A-Z) with the page', async () => {
    const result = await service.RoleLists(q());
    expect(result.meta.userCategoryOptions).toEqual([
      { value: 2, label: 'External' },
      { value: 1, label: 'Internal' },
    ].sort((a, b) => a.label.localeCompare(b.label)));
    expect(result.meta.userCategoryOptions.map((o) => o.label)).toEqual(['External', 'Internal']);
  });
});
