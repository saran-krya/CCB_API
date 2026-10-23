import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RolePermissionsService } from './role-permissions.service';
import { RolePermission } from './entities/role-permission.entity';
import { Role } from '../role/entities/role.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';
import { Action } from '../actions/entities/action.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';
import { Screen } from '../screens/entities/screen.entity';
import { AuditService } from '../../audit/audit.service';
import { IamService } from '../iam/iam.service';

// Isolated unit tests for RolePermissionsService.savePermissions/updateRolePermissions' new audit
// trail (Phase 0 of the RBAC assessment — the real, confirmed gap: permission grants/revokes were
// never audited, only Role's own name/description fields were). Both methods now run inside a
// DataSource transaction so a failure anywhere (role-name conflict, a bad id, etc.) rolls back the
// permission rows AND the audit row together — never a misleading audit entry for a change that
// didn't actually commit. Every dependency mocked, no real database connection.
describe('RolePermissionsService audit trail', () => {
  let service: RolePermissionsService;
  let auditService: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let roleRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let rolePermissionRepo: {
    delete: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let manager: { getRepository: jest.Mock };

  const ROLE = { id: 5, roleName: 'Finance Reviewer', roleDescription: 'x', userCategoryId: 1 } as Role;

  beforeEach(async () => {
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    roleRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((data) => data),
    };

    const queryBuilderStub = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    rolePermissionRepo = {
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((data) => data),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilderStub),
    };

    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Role) return roleRepo;
        if (entity === RolePermission) return rolePermissionRepo;
        throw new Error(`Unexpected repository requested: ${entity}`);
      }),
    };

    dataSource = { transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RolePermissionsService,
        { provide: getRepositoryToken(RolePermission), useValue: {} },
        { provide: getRepositoryToken(Role), useValue: {} },
        { provide: getRepositoryToken(SubModule), useValue: {} },
        { provide: getRepositoryToken(Action), useValue: {} },
        { provide: getRepositoryToken(PModule), useValue: {} },
        { provide: getRepositoryToken(Screen), useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: auditService },
        { provide: IamService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(RolePermissionsService);
  });

  describe('savePermissions', () => {
    it('creates the role, grants permissions, and records a CREATE audit entry inside the same transaction', async () => {
      roleRepo.findOne.mockResolvedValue(null); // no existing role with this name
      roleRepo.save.mockResolvedValue(ROLE);

      const result = await service.savePermissions(
        {
          roleName: 'Finance Reviewer',
          screenPermissionList: [
            { moduleId: 1, hasAccess: true, subModule: [], screens: [{ screenId: 10, hasAccess: true, actions: [{ actionId: 100, hasAccess: true }] }] },
          ],
        } as any,
        7,
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(result.roleId).toBe(ROLE.id);
      expect(result.count).toBe(1);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          moduleName: 'role_permissions',
          entityId: ROLE.id,
          action: 'CREATE',
          performedBy: 7,
          newValue: expect.objectContaining({ roleId: ROLE.id, grantedCount: 1 }),
        }),
        manager,
      );
    });

    it('rolls back without auditing when the role name already exists', async () => {
      roleRepo.findOne.mockResolvedValue(ROLE); // name conflict

      await expect(
        service.savePermissions({ roleName: 'Finance Reviewer', screenPermissionList: [] } as any, 7),
      ).rejects.toThrow(ConflictException);

      expect(auditService.record).not.toHaveBeenCalled();
      expect(rolePermissionRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateRolePermissions', () => {
    it('captures the previous granted action codes as oldValue and the new ones as newValue', async () => {
      roleRepo.findOne.mockResolvedValue({ ...ROLE });
      roleRepo.save.mockResolvedValue(ROLE);

      const qb = rolePermissionRepo.createQueryBuilder();
      qb.getRawMany
        .mockResolvedValueOnce([{ code: 'VIEW_CUSTOMER' }, { code: 'EDIT_CUSTOMER' }]) // previous, read before delete
        .mockResolvedValueOnce([{ code: 'VIEW_CUSTOMER' }]); // after re-insert

      const result = await service.updateRolePermissions(
        ROLE.id,
        {
          roleName: 'Finance Reviewer',
          screenPermissionList: [
            { moduleId: 1, hasAccess: true, subModule: [], screens: [{ screenId: 10, hasAccess: true, actions: [{ actionId: 100, hasAccess: true }] }] },
          ],
        } as any,
        9,
      );

      expect(result.roleId).toBe(ROLE.id);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          moduleName: 'role_permissions',
          entityId: ROLE.id,
          action: 'UPDATE',
          performedBy: 9,
          oldValue: { actionCodes: ['VIEW_CUSTOMER', 'EDIT_CUSTOMER'] },
          newValue: { actionCodes: ['VIEW_CUSTOMER'] },
        }),
        manager,
      );
    });

    it('throws NotFoundException and never audits when the role does not exist', async () => {
      roleRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateRolePermissions(999, { roleName: 'X', screenPermissionList: [] } as any, 9),
      ).rejects.toThrow(NotFoundException);

      expect(auditService.record).not.toHaveBeenCalled();
    });
  });
});
