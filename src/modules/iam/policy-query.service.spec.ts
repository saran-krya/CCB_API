import { NotFoundException } from '@nestjs/common';
import { PolicyQueryService } from './policy-query.service';

// The Policies list and a policy's attached-roles table are searched, filtered, sorted and paged by the API,
// which also writes each row's labels and says whether the policy may be deleted.
describe('PolicyQueryService', () => {
  let service: PolicyQueryService;
  let policiesExist: jest.Mock;
  let andWhereCalls: { sql: string; params?: Record<string, unknown> }[];
  let orderByCalls: { column: string; order?: string }[];
  let addOrderByCalls: { column: string; order?: string }[];
  let items: any[];
  let attachedCountRows: { policyId: number; count: string }[];
  let statements: { policyId: number; actions: string[] }[];

  const newQb = () => {
    const qb: any = {
      addSelect: () => qb,
      innerJoin: () => qb,
      leftJoinAndSelect: () => qb,
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
      getManyAndCount: async () => [items, items.length],
      select: () => qb,
      where: () => qb,
      groupBy: () => qb,
      addGroupBy: () => qb,
      getRawMany: async () => attachedCountRows,
    };
    return qb;
  };

  beforeEach(() => {
    andWhereCalls = [];
    orderByCalls = [];
    addOrderByCalls = [];
    items = [];
    attachedCountRows = [];
    statements = [];
    policiesExist = jest.fn().mockResolvedValue(true);
    service = new PolicyQueryService(
      { createQueryBuilder: newQb, exist: policiesExist, manager: { createQueryBuilder: newQb } } as any,
      { find: jest.fn().mockImplementation(async () => statements) } as any,
      { createQueryBuilder: newQb } as any,
    );
  });

  const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 10, sortBy: 'name', sortOrder: 'ASC', ...over }) as any;

  describe('list', () => {
    it('adds no filter condition when nothing is searched or filtered', async () => {
      await service.list(q());
      expect(andWhereCalls).toHaveLength(0);
    });

    it('searches the name or description, filters by type through the flag, and excludes given ids', async () => {
      await service.list(q({ 'search.query': ' audit ', type: 'custom', excludeIds: [3, 4] }));
      expect(andWhereCalls[0].sql).toContain('policy.name LIKE :term');
      expect(andWhereCalls[0].params).toEqual({ term: '%audit%' });
      expect(andWhereCalls[1]).toEqual({ sql: 'policy.isSystem = :isSystem', params: { isSystem: false } });
      expect(andWhereCalls[2]).toEqual({ sql: 'policy.id NOT IN (:...excludeIds)', params: { excludeIds: [3, 4] } });
    });

    it('filters by attachment with a count subquery (> 0 / = 0)', async () => {
      await service.list(q({ attachment: 'attached' }));
      expect(andWhereCalls[0].sql).toMatch(/role_policies[\s\S]*> 0$/);
      andWhereCalls.length = 0;
      await service.list(q({ attachment: 'unattached' }));
      expect(andWhereCalls[0].sql).toMatch(/= 0$/);
    });

    it('sorts by used-as through an alias, by type through the flag, with a name tie-break', async () => {
      await service.list(q({ sortBy: 'usedAs', sortOrder: 'DESC' }));
      expect(orderByCalls[0]).toEqual({ column: 'attached_role_count', order: 'DESC' });
      expect(addOrderByCalls[0]).toEqual({ column: 'policy.name', order: 'ASC' });

      orderByCalls.length = 0;
      addOrderByCalls.length = 0;
      await service.list(q({ sortBy: 'name' }));
      expect(orderByCalls[0].column).toBe('policy.name');
      expect(addOrderByCalls).toHaveLength(0);

      orderByCalls.length = 0;
      await service.list(q({ sortBy: 'type' }));
      expect(orderByCalls[0].column).toBe('policy.isSystem');
    });

    it('writes each row: type label from the flag, used-as text, action count and why it cannot be deleted', async () => {
      items = [
        { id: 1, name: 'SUPER_ADMIN Policy', description: null, isSystem: true },
        { id: 2, name: 'Finance', description: 'x', isSystem: false },
        { id: 3, name: 'Unused', description: null, isSystem: false },
      ];
      attachedCountRows = [
        { policyId: 1, count: '1' },
        { policyId: 2, count: '2' },
      ];
      statements = [
        { policyId: 2, actions: ['VIEW_USER', 'EDIT_USER'] },
        { policyId: 2, actions: ['EDIT_USER', 'TARIFF_VIEW'] },
      ];

      const { items: rows } = await service.list(q());

      expect(rows.map((r) => [r.typeLabel, r.usedAsLabel, r.actionCount])).toEqual([
        ['System', '1 role', 0],
        ['Custom', '2 roles', 3],
        ['Custom', 'None', 0],
      ]);
      expect(rows[0].deleteBlockedReason).toMatch(/system-managed/);
      expect(rows[1].deleteBlockedReason).toMatch(/Attached to 2 roles/);
      expect(rows[2].deleteBlockedReason).toBeNull();
    });

    it('offers the attachment and type filter options with the page', async () => {
      const { meta } = await service.list(q());
      expect(meta.attachmentOptions.map((o) => o.value)).toEqual(['attached', 'unattached']);
      expect(meta.typeOptions.map((o) => o.value)).toEqual(['system', 'custom']);
    });
  });

  describe('attachedRoles', () => {
    it('404s for a policy that does not exist', async () => {
      policiesExist.mockResolvedValue(false);
      await expect(service.attachedRoles(9, q({ sortBy: 'roleName' }))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('searches by role name, filters by category and sorts by name or category', async () => {
      await service.attachedRoles(1, q({ sortBy: 'userCategory', sortOrder: 'DESC', 'search.query': 'fin', userCategoryId: 2 }));
      expect(andWhereCalls.map((c) => c.params)).toEqual([{ term: '%fin%' }, { userCategoryId: 2 }]);
      expect(orderByCalls[0]).toEqual({ column: 'userCategory.label', order: 'DESC' });
      expect(addOrderByCalls[0]).toEqual({ column: 'role.roleName', order: 'ASC' });

      orderByCalls.length = 0;
      addOrderByCalls.length = 0;
      await service.attachedRoles(1, q({ sortBy: 'roleName' }));
      expect(orderByCalls[0].column).toBe('role.roleName');
      expect(addOrderByCalls).toHaveLength(0);
    });

    it("returns each role's category and the category options the attached roles actually have (A-Z)", async () => {
      items = [{ id: 4, roleName: 'FINANCE', userCategory: { label: 'Internal' } }, { id: 5, roleName: 'NONE', userCategory: null }];
      attachedCountRows = [{ policyId: 0, count: '0', id: 2, label: 'Internal' } as any, { id: 1, label: 'External' } as any];

      const result = await service.attachedRoles(1, q({ sortBy: 'roleName' }));

      expect(result.items).toEqual([
        { id: 4, roleName: 'FINANCE', userCategoryLabel: 'Internal' },
        { id: 5, roleName: 'NONE', userCategoryLabel: null },
      ]);
      expect(result.meta.userCategoryOptions.map((o) => o.label)).toEqual(['External', 'Internal']);
    });
  });
});
