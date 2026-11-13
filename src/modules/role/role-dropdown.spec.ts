import { RoleService } from './role.service';
import { AuditService } from '../../audit/audit.service';
import { LovService } from '../lov/lov.service';
import { UserRoleService } from '../user-role/user-role.service';
import { AssignmentBoundaryService } from '../iam/assignment-boundary.service';
import { Actor, SYSTEM_ACTOR } from '../../common/security/actor';

// RoleService.getRoleDropdown feeds the Roles picker on Create / Edit User. It also returns how many users
// hold each role (the Role Management "Assigned Users" number) — from ONE grouped count for the whole list —
// and, for each role, whether the SIGNED-IN user may assign it. SUPER_ADMIN is only ever OFFERED to a SUPER_ADMIN: the query itself
// excludes it for everyone else (hideAdministratorRoles). The `assignable` flag stays as a second line of defence — the very rule
// UserRoleService enforces on the write (HTTP 403) — so a row that nevertheless reaches the list is still shown unassignable.
const SUPER_ADMIN_ONLY = 'Only SUPER_ADMIN can assign this role.';

const superAdmin: Actor = { kind: 'user', id: 1, roleNames: ['SUPER_ADMIN'] };
const delegatedAdmin: Actor = { kind: 'user', id: 2, roleNames: ['USER_MANAGER'] };
// A user who holds SUPER_ADMIN only as a SECONDARY role is a SUPER_ADMIN for this purpose, like everywhere else.
const secondarySuperAdmin: Actor = { kind: 'user', id: 3, roleNames: ['USER_MANAGER', 'SUPER_ADMIN'] };

// The assignment boundary (AssignmentBoundaryService): the permissions the viewer holds, and — per role — the ones that role grants beyond
// them. `excess` maps a role id to the codes it grants that the viewer does not hold; every role not named fits inside the viewer's scope, so
// the expectations about the administrator-role rule alone are unaffected by it.
const boundaryMock = (excess: Record<number, string[]> = {}) => ({
  codesHeldBy: jest.fn().mockResolvedValue(new Set<string>(['VIEW_USER', 'CREATE_USER'])),
  excessOf: jest.fn(async (roleIds: number[]) => new Map(roleIds.map((id): [number, string[]] => [id, excess[id] ?? []]))),
});
const BEYOND_SCOPE = 'This role grants permissions you do not hold.';

describe('RoleService.getRoleDropdown — assigned user counts', () => {
  let service: RoleService;
  let qb: { leftJoinAndSelect: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; getMany: jest.Mock };
  let userRoleService: { getUserCountsByRoleIds: jest.Mock };
  let boundary: ReturnType<typeof boundaryMock>;

  const role = (id: number, roleName: string) => ({
    id,
    roleName,
    roleDescription: null,
    userCategoryId: 1,
    userCategory: { label: 'Internal' },
    canBeReportingManager: false,
  });

  beforeEach(() => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([role(1, 'FINANCE'), role(2, 'CUSTOMER_SUPPORT'), role(3, 'EMPTY_ROLE')]),
    };
    userRoleService = { getUserCountsByRoleIds: jest.fn().mockResolvedValue(new Map([[1, 4], [2, 1]])) };
    boundary = boundaryMock();
    service = new RoleService(
      { createQueryBuilder: jest.fn().mockReturnValue(qb) } as any,
      {} as LovService,
      {} as AuditService,
      userRoleService as unknown as UserRoleService,
      {} as any,
      boundary as unknown as AssignmentBoundaryService,
    );
  });

  it('adds each role\'s assigned user count — 0 for a role nobody holds (absent from the grouped result)', async () => {
    const result = await service.getRoleDropdown();

    expect(result.map((r) => [r.name, r.assignedUserCount])).toEqual([
      ['FINANCE', 4],
      ['CUSTOMER_SUPPORT', 1],
      ['EMPTY_ROLE', 0],
    ]);
  });

  it('counts every listed role in ONE grouped query (no per-role query)', async () => {
    await service.getRoleDropdown();

    expect(userRoleService.getUserCountsByRoleIds).toHaveBeenCalledTimes(1);
    expect(userRoleService.getUserCountsByRoleIds).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('keeps the existing fields the picker already relied on', async () => {
    const [first] = await service.getRoleDropdown(undefined, delegatedAdmin);

    expect(first).toEqual({
      id: 1,
      name: 'FINANCE',
      description: null,
      userCategoryId: 1,
      userCategoryLabel: 'Internal',
      canBeReportingManager: false,
      assignedUserCount: 4,
      assignable: true,
      assignableReason: null,
    });
  });

  // The query is what keeps SUPER_ADMIN out of the list for everyone but a super administrator.
  describe('SUPER_ADMIN is not offered at all to a viewer who is not a super administrator', () => {
    const administratorFilters = () => qb.andWhere.mock.calls.filter(([sql]: [string]) => /BINARY role\.roleName <> :administratorRole0/.test(sql));

    it('excludes it in the query, by EXACT name, for a delegated administrator and for no viewer at all', async () => {
      await service.getRoleDropdown(undefined, delegatedAdmin);
      expect(administratorFilters()).toEqual([['BINARY role.roleName <> :administratorRole0', { administratorRole0: 'SUPER_ADMIN' }]]);

      qb.andWhere.mockClear();
      await service.getRoleDropdown();
      expect(administratorFilters()).toHaveLength(1);
    });

    it('does not exclude it for a super administrator (also by a secondary role) or for the system', async () => {
      await service.getRoleDropdown(undefined, superAdmin);
      await service.getRoleDropdown(undefined, secondarySuperAdmin);
      await service.getRoleDropdown(undefined, SYSTEM_ACTOR);

      expect(administratorFilters()).toHaveLength(0);
    });

    it('keeps the category filter next to it', async () => {
      await service.getRoleDropdown(4, delegatedAdmin);

      expect(qb.andWhere).toHaveBeenCalledWith('role.userCategoryId = :userCategoryId', { userCategoryId: 4 });
      expect(administratorFilters()).toHaveLength(1);
    });
  });

  // Second line of defence: the flag itself. (The mocked query below ignores the exclusion, so it stands for a row that slipped through.)
  describe('should an administrator role reach the list anyway, it is flagged unassignable for anyone but a SUPER_ADMIN', () => {
    beforeEach(() => {
      qb.getMany.mockResolvedValue([role(1, 'SUPER_ADMIN'), role(2, 'ADMIN'), role(3, 'FINANCE')]);
    });

    const byName = (rows: Awaited<ReturnType<RoleService['getRoleDropdown']>>) =>
      Object.fromEntries(rows.map((r) => [r.name, { assignable: r.assignable, assignableReason: r.assignableReason }]));

    it('a viewer who is NOT a SUPER_ADMIN still SEES SUPER_ADMIN, but it is flagged unassignable with the exact reason — every other role stays assignable', async () => {
      const rows = await service.getRoleDropdown(undefined, delegatedAdmin);

      expect(rows.map((r) => r.name)).toEqual(['SUPER_ADMIN', 'ADMIN', 'FINANCE']);
      expect(byName(rows)).toEqual({
        SUPER_ADMIN: { assignable: false, assignableReason: SUPER_ADMIN_ONLY },
        ADMIN: { assignable: true, assignableReason: null },
        FINANCE: { assignable: true, assignableReason: null },
      });
    });

    it('a SUPER_ADMIN viewer can assign every role, SUPER_ADMIN included, and gets no reason', async () => {
      const rows = await service.getRoleDropdown(undefined, superAdmin);

      expect(byName(rows)).toEqual({
        SUPER_ADMIN: { assignable: true, assignableReason: null },
        ADMIN: { assignable: true, assignableReason: null },
        FINANCE: { assignable: true, assignableReason: null },
      });
    });

    it('a viewer holding SUPER_ADMIN as a secondary role is treated as a SUPER_ADMIN', async () => {
      const rows = await service.getRoleDropdown(undefined, secondarySuperAdmin);

      expect(byName(rows).SUPER_ADMIN).toEqual({ assignable: true, assignableReason: null });
    });

    it('with NO actor at all the safe answer applies: SUPER_ADMIN is not assignable', async () => {
      const rows = await service.getRoleDropdown();

      expect(byName(rows).SUPER_ADMIN).toEqual({ assignable: false, assignableReason: SUPER_ADMIN_ONLY });
    });

    it('the system actor (no signed-in user) may assign it, like the boot-time seed does', async () => {
      const rows = await service.getRoleDropdown(undefined, SYSTEM_ACTOR);

      expect(byName(rows).SUPER_ADMIN).toEqual({ assignable: true, assignableReason: null });
    });

    it('the reason text is exactly the one the web app shows as the disabled-option tooltip', () => {
      expect(SUPER_ADMIN_ONLY).toBe('Only SUPER_ADMIN can assign this role.');
    });

    it('the flag is decided from the role NAME the server holds — a look-alike role name is an ordinary role', async () => {
      qb.getMany.mockResolvedValue([role(1, 'SUPER_ADMIN_VIEWER'), role(2, 'super_admin')]);

      const rows = await service.getRoleDropdown(undefined, delegatedAdmin);

      // Only the exact reserved name is restricted; reserved names cannot be created in a look-alike form
      // either (see RoleService.create), so there is nothing to confuse.
      expect(rows.find((r) => r.name === 'SUPER_ADMIN_VIEWER')?.assignable).toBe(true);
    });
  });

  // The ASSIGNMENT BOUNDARY, mirrored on the screen: a delegated administrator may assign a role only if every permission it grants is one the
  // administrator holds. UserRoleService enforces the same rule on the write (403); this is the picker saying so up front.
  describe('a role that grants permissions the viewer does not hold is flagged unassignable', () => {
    beforeEach(() => {
      qb.getMany.mockResolvedValue([role(1, 'FINANCE'), role(2, 'CUSTOMER_SUPPORT'), role(3, 'EMPTY_ROLE')]);
    });

    it('flags only the role beyond the viewer\'s scope, with the exact reason — roles inside it stay assignable', async () => {
      boundary.excessOf.mockImplementation(async (roleIds: number[]) =>
        new Map(roleIds.map((id): [number, string[]] => [id, id === 1 ? ['APPROVE_PAYMENT', 'VIEW_LEDGER'] : []])),
      );

      const rows = await service.getRoleDropdown(undefined, delegatedAdmin);

      expect(rows.map((r) => [r.name, r.assignable, r.assignableReason])).toEqual([
        ['FINANCE', false, BEYOND_SCOPE],
        ['CUSTOMER_SUPPORT', true, null],
        ['EMPTY_ROLE', true, null],
      ]);
    });

    it('asks for the viewer\'s permissions ONCE and compares the whole list in ONE lookup (no per-role query)', async () => {
      await service.getRoleDropdown(undefined, delegatedAdmin);

      expect(boundary.codesHeldBy).toHaveBeenCalledTimes(1);
      expect(boundary.codesHeldBy).toHaveBeenCalledWith(delegatedAdmin);
      expect(boundary.excessOf).toHaveBeenCalledTimes(1);
      expect(boundary.excessOf).toHaveBeenCalledWith([1, 2, 3], new Set(['VIEW_USER', 'CREATE_USER']));
    });

    it('the administrator-role reason wins over the scope reason — SUPER_ADMIN is never "assignable once you hold enough"', async () => {
      qb.getMany.mockResolvedValue([role(1, 'SUPER_ADMIN'), role(2, 'FINANCE')]);
      boundary.excessOf.mockImplementation(async (roleIds: number[]) => new Map(roleIds.map((id): [number, string[]] => [id, ['ANYTHING']])));

      const rows = await service.getRoleDropdown(undefined, delegatedAdmin);

      expect(rows.map((r) => [r.name, r.assignable, r.assignableReason])).toEqual([
        ['SUPER_ADMIN', false, SUPER_ADMIN_ONLY],
        ['FINANCE', false, BEYOND_SCOPE],
      ]);
    });

    it('a SUPER_ADMIN viewer (even by a secondary role) and the system are unbounded — the boundary is never consulted', async () => {
      boundary.excessOf.mockImplementation(async (roleIds: number[]) => new Map(roleIds.map((id): [number, string[]] => [id, ['ANYTHING']])));

      const asSuperAdmin = await service.getRoleDropdown(undefined, superAdmin);
      const asSecondary = await service.getRoleDropdown(undefined, secondarySuperAdmin);
      const asSystem = await service.getRoleDropdown(undefined, SYSTEM_ACTOR);

      for (const rows of [asSuperAdmin, asSecondary, asSystem]) {
        expect(rows.every((r) => r.assignable && r.assignableReason === null)).toBe(true);
      }
      expect(boundary.codesHeldBy).not.toHaveBeenCalled();
      expect(boundary.excessOf).not.toHaveBeenCalled();
    });

    it('with NO actor the boundary is not consulted either (the administrator-role rule already answers safely)', async () => {
      await service.getRoleDropdown();

      expect(boundary.codesHeldBy).not.toHaveBeenCalled();
      expect(boundary.excessOf).not.toHaveBeenCalled();
    });

    it('an empty role list asks nothing', async () => {
      qb.getMany.mockResolvedValue([]);

      await expect(service.getRoleDropdown(undefined, delegatedAdmin)).resolves.toEqual([]);

      expect(boundary.codesHeldBy).not.toHaveBeenCalled();
    });

    it('the reason text is exactly the one the web app shows as the disabled-option tooltip', () => {
      expect(BEYOND_SCOPE).toBe('This role grants permissions you do not hold.');
    });
  });
});

describe('RoleService.getRolePicker — paged picker with the same assignability', () => {
  let service: RoleService;
  let qb: Record<string, jest.Mock>;
  let userRoleService: { getUserCountsByRoleIds: jest.Mock };
  let lovService: { findByCategory: jest.Mock };
  let boundary: ReturnType<typeof boundaryMock>;

  const role = (id: number, roleName: string) => ({
    id,
    roleName,
    roleDescription: `${roleName} description`,
    userCategoryId: 1,
    userCategory: { label: 'Internal' },
    canBeReportingManager: false,
  });

  beforeEach(() => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[role(1, 'SUPER_ADMIN'), role(2, 'FINANCE')], 2]),
    };
    userRoleService = { getUserCountsByRoleIds: jest.fn().mockResolvedValue(new Map([[1, 2]])) };
    lovService = { findByCategory: jest.fn().mockResolvedValue([{ id: 1, label: 'Internal' }]) };
    boundary = boundaryMock();
    service = new RoleService(
      { createQueryBuilder: jest.fn().mockReturnValue(qb) } as any,
      lovService as unknown as LovService,
      {} as AuditService,
      userRoleService as unknown as UserRoleService,
      {} as any,
      boundary as unknown as AssignmentBoundaryService,
    );
  });

  const query = (overrides: Record<string, unknown> = {}) => ({ page: 1, limit: 5, sortBy: 'name', sortOrder: 'ASC', ...overrides }) as any;

  it('lists SUPER_ADMIN to a viewer who cannot assign it — flagged unassignable with the exact reason', async () => {
    const result = await service.getRolePicker(query(), delegatedAdmin);

    expect(result.items.map((r) => [r.name, r.assignable, r.assignableReason])).toEqual([
      ['SUPER_ADMIN', false, SUPER_ADMIN_ONLY],
      ['FINANCE', true, null],
    ]);
  });

  it('excludes SUPER_ADMIN in the query, by exact name, for a viewer who is not a super administrator — and for nobody else', async () => {
    const excludes = () => qb.andWhere.mock.calls.filter(([sql]: [string]) => /BINARY role\.roleName <> :administratorRole0/.test(sql));

    await service.getRolePicker(query(), delegatedAdmin);
    expect(excludes()).toEqual([['BINARY role.roleName <> :administratorRole0', { administratorRole0: 'SUPER_ADMIN' }]]);

    qb.andWhere.mockClear();
    await service.getRolePicker(query());
    expect(excludes()).toHaveLength(1);

    qb.andWhere.mockClear();
    await service.getRolePicker(query(), superAdmin);
    await service.getRolePicker(query(), SYSTEM_ACTOR);
    expect(excludes()).toHaveLength(0);
  });

  it('flags every role assignable for a SUPER_ADMIN viewer', async () => {
    const result = await service.getRolePicker(query(), superAdmin);

    expect(result.items.map((r) => [r.name, r.assignable, r.assignableReason])).toEqual([
      ['SUPER_ADMIN', true, null],
      ['FINANCE', true, null],
    ]);
  });

  it('with no actor the safe answer applies', async () => {
    const result = await service.getRolePicker(query());

    expect(result.items[0]).toMatchObject({ name: 'SUPER_ADMIN', assignable: false, assignableReason: SUPER_ADMIN_ONLY });
  });

  it('keeps the paging, the user counts and the Type filter options alongside', async () => {
    const result = await service.getRolePicker(query(), delegatedAdmin);

    expect(result.pagination).toEqual({ page: 1, limit: 5, total: 2, totalPages: 1 });
    expect(result.items.map((r) => r.assignedUserCount)).toEqual([2, 0]);
    expect(result.meta.typeOptions).toEqual([{ value: 1, label: 'Internal' }]);
    expect(userRoleService.getUserCountsByRoleIds).toHaveBeenCalledTimes(1);
  });

  it('flags a role that grants permissions the viewer does not hold — the assignment boundary, with its exact reason', async () => {
    boundary.excessOf.mockImplementation(async (roleIds: number[]) =>
      new Map(roleIds.map((id): [number, string[]] => [id, id === 2 ? ['APPROVE_PAYMENT'] : []])),
    );

    const result = await service.getRolePicker(query(), delegatedAdmin);

    expect(result.items.map((r) => [r.name, r.assignable, r.assignableReason])).toEqual([
      ['SUPER_ADMIN', false, SUPER_ADMIN_ONLY],
      ['FINANCE', false, BEYOND_SCOPE],
    ]);
    expect(boundary.codesHeldBy).toHaveBeenCalledTimes(1);
    expect(boundary.excessOf).toHaveBeenCalledWith([1, 2], new Set(['VIEW_USER', 'CREATE_USER']));
  });

  it('never consults the boundary for a SUPER_ADMIN viewer or the system', async () => {
    boundary.excessOf.mockImplementation(async (roleIds: number[]) => new Map(roleIds.map((id): [number, string[]] => [id, ['ANYTHING']])));

    const asSuperAdmin = await service.getRolePicker(query(), superAdmin);
    const asSystem = await service.getRolePicker(query(), SYSTEM_ACTOR);

    expect(asSuperAdmin.items.every((r) => r.assignable)).toBe(true);
    expect(asSystem.items.every((r) => r.assignable)).toBe(true);
    expect(boundary.codesHeldBy).not.toHaveBeenCalled();
    expect(boundary.excessOf).not.toHaveBeenCalled();
  });
});
