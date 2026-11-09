import { RoleService } from './role.service';
import { AuditService } from '../../audit/audit.service';
import { LovService } from '../lov/lov.service';
import { UserRoleService } from '../user-role/user-role.service';
import { Actor, SYSTEM_ACTOR } from '../../common/security/actor';

// RoleService.getRoleDropdown feeds the Roles picker on Create / Edit User. It also returns how many users
// hold each role (the Role Management "Assigned Users" number) — from ONE grouped count for the whole list —
// and, for each role, whether the SIGNED-IN user may assign it. SUPER_ADMIN is listed for everyone but is
// assignable only by a SUPER_ADMIN; that is the very rule UserRoleService enforces on the write (HTTP 403), so
// the web app can show the option disabled with the exact reason instead of letting a request fail.
const SUPER_ADMIN_ONLY = 'Only SUPER_ADMIN can assign this role.';

const superAdmin: Actor = { kind: 'user', id: 1, roleNames: ['SUPER_ADMIN'] };
const delegatedAdmin: Actor = { kind: 'user', id: 2, roleNames: ['USER_MANAGER'] };
// A user who holds SUPER_ADMIN only as a SECONDARY role is a SUPER_ADMIN for this purpose, like everywhere else.
const secondarySuperAdmin: Actor = { kind: 'user', id: 3, roleNames: ['USER_MANAGER', 'SUPER_ADMIN'] };

describe('RoleService.getRoleDropdown — assigned user counts', () => {
  let service: RoleService;
  let qb: { leftJoinAndSelect: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; getMany: jest.Mock };
  let userRoleService: { getUserCountsByRoleIds: jest.Mock };

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
    service = new RoleService(
      { createQueryBuilder: jest.fn().mockReturnValue(qb) } as any,
      {} as LovService,
      {} as AuditService,
      userRoleService as unknown as UserRoleService,
      {} as any,
      { getOrganizationId: jest.fn().mockReturnValue(1) } as any,
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

  describe('SUPER_ADMIN is listed for everyone but assignable only by a SUPER_ADMIN', () => {
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
});

describe('RoleService.getRolePicker — paged picker with the same assignability', () => {
  let service: RoleService;
  let qb: Record<string, jest.Mock>;
  let userRoleService: { getUserCountsByRoleIds: jest.Mock };
  let lovService: { findByCategory: jest.Mock };

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
    service = new RoleService(
      { createQueryBuilder: jest.fn().mockReturnValue(qb) } as any,
      lovService as unknown as LovService,
      {} as AuditService,
      userRoleService as unknown as UserRoleService,
      {} as any,
      { getOrganizationId: jest.fn().mockReturnValue(1) } as any,
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
});
