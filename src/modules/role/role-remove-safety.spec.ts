import { ConflictException } from '@nestjs/common';
import { RoleService } from './role.service';
import { Role } from './entities/role.entity';
import { AuditService } from '../../audit/audit.service';
import { LovService } from '../lov/lov.service';
import { UserRoleService } from '../user-role/user-role.service';

// Isolated unit tests for RoleService.remove's safety checks — the real, confirmed gap this closes:
// the old remove() did a hard `repository.remove()` with no in-use check at all, and every FK into
// `roles` except workflow_instance_steps is ON DELETE CASCADE. Deleting a role with users still
// assigned to it would have silently deleted their user_roles rows too (instant, unexplained login
// lockout — see AuthService.login's own "no role assigned" rejection), with no recovery since it
// was a hard delete. Every dependency mocked, no real database connection; these tests assert
// against the real service, never the deleted behavior.
describe('RoleService.remove — safety checks', () => {
  let service: RoleService;
  let roleRepo: { findOne: jest.Mock };
  let userRoleService: { getUsersByRoleId: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let auditService: { record: jest.Mock };
  let managerSoftRemove: jest.Mock;
  let managerQuery: jest.Mock;

  const ROLE = { id: 7, roleName: 'Test Role' } as Role;

  beforeEach(() => {
    roleRepo = { findOne: jest.fn().mockResolvedValue(ROLE) };
    userRoleService = { getUsersByRoleId: jest.fn().mockResolvedValue([]) };

    managerSoftRemove = jest.fn().mockResolvedValue(ROLE);
    managerQuery = jest.fn().mockResolvedValue(undefined);
    const manager = {
      query: managerQuery,
      getRepository: jest.fn().mockReturnValue({ softRemove: managerSoftRemove }),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([{ count: 0 }]),
      // Mirrors the real DataSource.transaction signature closely enough for this unit: run the
      // callback against a stub manager and return whatever it returns.
      transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    service = new RoleService(
      roleRepo as any,
      {} as LovService,
      auditService as unknown as AuditService,
      userRoleService as unknown as UserRoleService,
      dataSource as any,
    );
  });

  it('rejects deletion of SUPER_ADMIN by name, before any other check even runs', async () => {
    roleRepo.findOne.mockResolvedValue({ id: 1, roleName: 'SUPER_ADMIN' } as Role);

    const error: ConflictException = await service.remove(1).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toMatch(/SUPER_ADMIN is a system-managed role/);
    expect(userRoleService.getUsersByRoleId).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('does not block deleting a different role that merely contains "SUPER_ADMIN" as a substring', async () => {
    roleRepo.findOne.mockResolvedValue({ id: 9, roleName: 'SUPER_ADMIN_BACKUP' } as Role);

    await expect(service.remove(9)).resolves.toEqual({ message: 'Role deleted successfully' });
  });

  it('rejects deletion when the role is still assigned to one or more users, before any write', async () => {
    userRoleService.getUsersByRoleId.mockResolvedValue([{ userId: 1 }]);

    await expect(service.remove(7)).rejects.toThrow(ConflictException);
    await expect(service.remove(7)).rejects.toThrow(/assigned to 1 user/);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled(); // short-circuits before the workflow checks too
  });

  it('pluralizes the assigned-user count correctly', async () => {
    userRoleService.getUsersByRoleId.mockResolvedValue([{ userId: 1 }, { userId: 2 }]);

    await expect(service.remove(7)).rejects.toThrow(/assigned to 2 users/);
  });

  it('rejects deletion when the role is configured as a workflow approver', async () => {
    dataSource.query.mockResolvedValue([{ count: 1 }]); // every query call sees count:1

    const error: ConflictException = await service.remove(7).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toMatch(/approver in one or more approval workflows/);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects deletion when an in-progress workflow step references the role', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ count: 0 }]) // approval/definition levels — clear
      .mockResolvedValue([{ count: 1 }]); // instance steps (and any later call) — blocks

    const error: ConflictException = await service.remove(7).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toMatch(/in-progress workflow step/);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('soft-deletes (never a hard remove) and audits once every check clears', async () => {
    const result = await service.remove(7, 42);

    expect(managerSoftRemove).toHaveBeenCalledWith(ROLE);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ moduleName: 'roles', entityId: 7, action: 'DELETE', performedBy: 42 }),
    );
    expect(result).toEqual({ message: 'Role deleted successfully' });
  });

  it('cleans up the role\'s own role_policies/role_permissions rows in the same transaction as the soft-delete', async () => {
    await service.remove(7);

    expect(managerQuery).toHaveBeenCalledWith(expect.stringContaining('role_policies'), [7]);
    expect(managerQuery).toHaveBeenCalledWith(expect.stringContaining('role_permissions'), [7]);
  });

  it('checks every guard in order: users, then workflow levels, then workflow steps', async () => {
    await service.remove(7);

    expect(userRoleService.getUsersByRoleId).toHaveBeenCalledWith(7);
    expect(dataSource.query.mock.calls[0][0]).toMatch(/workflow_approval_levels/);
    expect(dataSource.query.mock.calls[1][0]).toMatch(/workflow_instance_steps/);
  });
});
