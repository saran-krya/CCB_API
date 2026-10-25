import { UserService } from './user.service';

// Users list now has ONE search box (matching Role Management's own single-search layout) instead
// of four independent AND'd filters (search.fullName/search.email/search.mobile/search.role) — this
// suite proves UserService.findAll builds exactly one OR'd condition across name/email/mobile/role
// when a search term is given, and no filter condition at all when it's empty, against the REAL
// query-building code path (not a hand-copied assumption about what SQL it emits).
describe('UserService.findAll — single combined search (name OR email OR mobile OR role)', () => {
  let andWhereCalls: { sql: string; params?: Record<string, unknown> }[];
  let usersRepo: { createQueryBuilder: jest.Mock };
  let service: UserService;

  function makeQueryBuilderStub() {
    const qb: any = {
      leftJoin: () => qb,
      leftJoinAndMapOne: () => qb,
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        andWhereCalls.push({ sql, params });
        return qb;
      },
      orderBy: () => qb,
      skip: () => qb,
      take: () => qb,
      getManyAndCount: async () => [[], 0],
    };
    return qb;
  }

  beforeEach(() => {
    andWhereCalls = [];
    usersRepo = { createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilderStub()) };
    service = new UserService(
      usersRepo as any,
      {} as any, // RolePermissionsService — unused by findAll
      {} as any, // RoleService
      {} as any, // AuditService
      {} as any, // AttributeService
      {} as any, // LovService
      {} as any, // UserRoleService
    );
  });

  it('adds no filter condition at all when search.query is empty', async () => {
    await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC' } as any);
    expect(andWhereCalls).toHaveLength(0);
  });

  it('adds exactly one OR\'d condition covering name, email, mobile and role when search.query is given', async () => {
    await service.findAll({ page: 1, limit: 10, sortOrder: 'DESC', ['search.query']: 'john' } as any);
    expect(andWhereCalls).toHaveLength(1);
    const [{ sql, params }] = andWhereCalls;
    expect(sql).toContain('LIKE :term');
    expect(sql).toMatch(/OR\s+user\.email LIKE :term/);
    expect(sql).toMatch(/OR\s+user\.mobile LIKE :term/);
    expect(sql).toMatch(/OR\s+role\.roleName LIKE :term/);
    expect(params).toEqual({ term: '%john%' });
  });
});
