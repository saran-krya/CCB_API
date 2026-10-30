import { RoleService } from './role.service';
import { AuditService } from '../../audit/audit.service';
import { LovService } from '../lov/lov.service';
import { UserRoleService } from '../user-role/user-role.service';

// RoleService.getRoleDropdown feeds the Roles picker on Create / Edit User. It now also returns how many users
// hold each role (the Role Management "Assigned Users" number) — from ONE grouped count for the whole list.
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
    const [first] = await service.getRoleDropdown();

    expect(first).toEqual({
      id: 1,
      name: 'FINANCE',
      description: null,
      userCategoryId: 1,
      userCategoryLabel: 'Internal',
      canBeReportingManager: false,
      assignedUserCount: 4,
    });
  });
});
