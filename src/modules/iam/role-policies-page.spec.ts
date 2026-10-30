import { NotFoundException } from '@nestjs/common';
import { IamService } from './iam.service';

// The Role Details attached-policies table: searched, type-filtered, sorted and paged by the API, with
// the type label read from the persisted isSystem flag (never guessed from the policy's name).
describe('IamService.getPoliciesForRolePage', () => {
  let service: IamService;
  let rolesRepo: { exist: jest.Mock };
  let andWhereCalls: { sql: string; params?: Record<string, unknown> }[];
  let orderByCalls: { column: string; order?: string }[];
  let addOrderByCalls: { column: string; order?: string }[];
  let items: any[];
  let attachedCounts: { policyId: string; count: string }[];

  beforeEach(() => {
    andWhereCalls = [];
    orderByCalls = [];
    addOrderByCalls = [];
    items = [];
    attachedCounts = [];
    rolesRepo = { exist: jest.fn().mockResolvedValue(true) };

    const qb: any = {
      innerJoin: () => qb,
      addSelect: () => qb,
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
      groupBy: () => qb,
      getRawMany: async () => attachedCounts,
    };

    service = new IamService(
      {} as any,
      { createQueryBuilder: () => qb } as any, // policies
      {} as any,
      { createQueryBuilder: () => qb } as any, // rolePolicies (the attached-count grouping)
      rolesRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any, // roleInlinePolicies — not exercised by this spec
    );
  });

  const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 10, sortBy: 'name', sortOrder: 'ASC', ...over }) as any;

  it('404s for a role that does not exist', async () => {
    rolesRepo.exist.mockResolvedValue(false);
    await expect(service.getPoliciesForRolePage(99, q())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('searches the name or description, and filters by type through the persisted flag', async () => {
    await service.getPoliciesForRolePage(1, q({ 'search.query': ' audit ', type: 'system' }));
    expect(andWhereCalls[0].sql).toContain('policy.name LIKE :term');
    expect(andWhereCalls[0].params).toEqual({ term: '%audit%' });
    expect(andWhereCalls[1]).toEqual({ sql: 'policy.isSystem = :isSystem', params: { isSystem: true } });

    andWhereCalls.length = 0;
    await service.getPoliciesForRolePage(1, q({ type: 'custom' }));
    expect(andWhereCalls[0].params).toEqual({ isSystem: false });
  });

  it('sorts by name, type (the flag) or attached entities (an alias), with a name tie-break', async () => {
    await service.getPoliciesForRolePage(1, q({ sortBy: 'attachedEntities', sortOrder: 'DESC' }));
    expect(orderByCalls[0]).toEqual({ column: 'attached_entities', order: 'DESC' });
    expect(addOrderByCalls[0]).toEqual({ column: 'policy.name', order: 'ASC' });

    orderByCalls.length = 0;
    await service.getPoliciesForRolePage(1, q({ sortBy: 'type' }));
    expect(orderByCalls[0].column).toBe('policy.isSystem');

    orderByCalls.length = 0;
    addOrderByCalls.length = 0;
    await service.getPoliciesForRolePage(1, q());
    expect(orderByCalls[0].column).toBe('policy.name');
    expect(addOrderByCalls).toHaveLength(0);
  });

  it('labels each row from the isSystem flag and carries the attached-role count', async () => {
    items = [
      { id: 1, name: 'Renamed system policy', description: null, isSystem: true },
      { id: 2, name: 'SUPER_ADMIN Policy', description: 'x', isSystem: false },
    ];
    attachedCounts = [{ policyId: '1', count: '3' }];

    const result = await service.getPoliciesForRolePage(1, q());

    expect(result.items).toEqual([
      { id: 1, name: 'Renamed system policy', description: null, isSystem: true, typeLabel: 'System', attachedRoleCount: 3 },
      { id: 2, name: 'SUPER_ADMIN Policy', description: 'x', isSystem: false, typeLabel: 'Custom', attachedRoleCount: 0 },
    ]);
  });

  it('offers the type filter options with the page', async () => {
    const result = await service.getPoliciesForRolePage(1, q());
    expect(result.meta.typeOptions).toEqual([
      { value: 'system', label: 'System' },
      { value: 'custom', label: 'Custom' },
    ]);
  });
});
