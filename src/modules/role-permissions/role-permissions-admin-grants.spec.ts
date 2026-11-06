import { RolePermissionsService } from './role-permissions.service';

// RolePermissionsService.ensureAdminGrants is the boot-time sync of the legacy permission tree. SUPER_ADMIN is the ONLY
// predefined role, so it is the only role this ever looks up or grants — every other role is created dynamically by
// SUPER_ADMIN, whatever it is called. SUPER_ADMIN is also never handed a business-approval code.
describe('RolePermissionsService.ensureAdminGrants — SUPER_ADMIN only', () => {
  const screen = { id: 5, subModuleId: 3, pModuleId: 1, subModule: { pModuleId: 1 } };
  const action = (id: number, code: string) => ({ id, code, isActive: true, screen });

  let roleRepo: { find: jest.Mock };
  let actionRepo: { find: jest.Mock };
  let permissionRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let service: RolePermissionsService;

  beforeEach(() => {
    roleRepo = { find: jest.fn().mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]) };
    actionRepo = {
      find: jest.fn().mockResolvedValue([action(1, 'VIEW_USER'), action(2, 'TARIFF_APPROVE'), action(3, 'WORKFLOW_MANAGE_APPROVERS')]),
    };
    permissionRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const empty = { find: jest.fn().mockResolvedValue([]) };
    // Constructor order: rolePermission, role, subModule, action, pModule, screen, dataSource, audit, iam.
    service = new RolePermissionsService(
      permissionRepo as never,
      roleRepo as never,
      empty as never,
      actionRepo as never,
      empty as never,
      empty as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('grants SUPER_ADMIN every active action except the business approvals — system configuration (WORKFLOW_MANAGE_APPROVERS) included', async () => {
    await service.ensureAdminGrants();

    expect(permissionRepo.save.mock.calls.map(([grant]) => [grant.roleId, grant.actionId])).toEqual([
      [2, 1], // VIEW_USER
      [2, 3], // WORKFLOW_MANAGE_APPROVERS
    ]);
  });

  it('is idempotent: an existing grant row is never duplicated', async () => {
    permissionRepo.findOne.mockResolvedValue({ id: 99 });

    await service.ensureAdminGrants();

    expect(permissionRepo.save).not.toHaveBeenCalled();
  });

  it('looks up ONLY the SUPER_ADMIN name — a role merely called ADMIN, or a look-alike of SUPER_ADMIN, is never granted anything', async () => {
    roleRepo.find.mockResolvedValue([
      { id: 9, roleName: 'ADMIN' },
      { id: 10, roleName: 'Super_Admin' },
    ]);

    await service.ensureAdminGrants();

    expect(roleRepo.find).toHaveBeenCalledWith({ where: { roleName: 'SUPER_ADMIN' } });
    expect(actionRepo.find).not.toHaveBeenCalled();
    expect(permissionRepo.save).not.toHaveBeenCalled();
  });
});
