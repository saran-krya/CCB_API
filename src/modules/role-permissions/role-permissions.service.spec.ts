import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
  // The catalogue lookups of the administration-permissions guard: by default nothing in the saved tree is an administration code.
  let actionCatalog: { find: jest.Mock };
  let subModuleCatalog: { find: jest.Mock };
  let screenCatalog: { find: jest.Mock };

  const ROLE = { id: 5, roleName: 'Finance Reviewer', roleDescription: 'x', userCategoryId: 1 } as Role;

  beforeEach(async () => {
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    actionCatalog = { find: jest.fn().mockResolvedValue([]) };
    subModuleCatalog = { find: jest.fn().mockResolvedValue([]) };
    screenCatalog = { find: jest.fn().mockResolvedValue([]) };

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
        { provide: getRepositoryToken(SubModule), useValue: subModuleCatalog },
        { provide: getRepositoryToken(Action), useValue: actionCatalog },
        { provide: getRepositoryToken(PModule), useValue: {} },
        { provide: getRepositoryToken(Screen), useValue: screenCatalog },
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

    it("refuses to rename SUPER_ADMIN to anything else, before any write or audit", async () => {
      roleRepo.findOne.mockResolvedValue({ id: 1, roleName: 'SUPER_ADMIN', roleDescription: '', userCategoryId: 1 } as Role);

      await expect(
        service.updateRolePermissions(1, { roleName: 'Root', screenPermissionList: [] } as any, 9),
      ).rejects.toThrow(ConflictException);

      expect(roleRepo.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('allows saving SUPER_ADMIN when roleName is resubmitted unchanged', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 1, roleName: 'SUPER_ADMIN', roleDescription: '', userCategoryId: 1 } as Role);
      roleRepo.save.mockResolvedValue({ id: 1, roleName: 'SUPER_ADMIN' });

      await expect(
        service.updateRolePermissions(1, { roleName: 'SUPER_ADMIN', roleDescription: 'Updated', screenPermissionList: [] } as any, 9),
      ).resolves.toBeDefined();

      expect(roleRepo.save).toHaveBeenCalled();
    });
  });

  // The administration console's permissions (Users, Roles, Policies — iam/administration-permissions.ts) belong to SUPER_ADMIN alone: the
  // legacy permission tree neither saves them for any other role nor shows them.
  describe('administration permissions', () => {
    const tree = (overrides: Record<string, unknown> = {}) =>
      ({ roleName: 'Finance Reviewer', screenPermissionList: [{ moduleId: 1, hasAccess: true, subModule: [], screens: [{ screenId: 10, hasAccess: true, actions: [{ actionId: 100, hasAccess: true }] }] }], ...overrides }) as any;

    it('refuses (400) to save an administration permission for a new role — nothing is written or audited', async () => {
      roleRepo.findOne.mockResolvedValue(null);
      roleRepo.save.mockResolvedValue(ROLE);
      actionCatalog.find.mockResolvedValue([{ id: 100, code: 'CREATE_USER' }]);

      await expect(service.savePermissions(tree(), 7)).rejects.toThrow(BadRequestException);
      await expect(service.savePermissions(tree(), 7)).rejects.toThrow(/CREATE_USER/);

      expect(rolePermissionRepo.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('refuses an administration page (System Admin > User Management) and its screen the same way, on update', async () => {
      roleRepo.findOne.mockResolvedValue({ ...ROLE });
      roleRepo.save.mockResolvedValue(ROLE);
      subModuleCatalog.find.mockResolvedValue([{ id: 5, code: 'USER_MANAGEMENT' }]);
      screenCatalog.find.mockResolvedValue([{ id: 10, code: 'USER_LIST' }]);

      await expect(
        service.updateRolePermissions(
          ROLE.id,
          tree({ screenPermissionList: [{ moduleId: 1, hasAccess: true, subModule: [{ subModuleId: 5, hasAccess: true, screens: [{ screenId: 10, hasAccess: true, actions: [] }] }], screens: [] }] }),
          9,
        ),
      ).rejects.toThrow(/USER_LIST, USER_MANAGEMENT/);

      expect(rolePermissionRepo.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('lets an ordinary business permission through for any role', async () => {
      roleRepo.findOne.mockResolvedValue({ ...ROLE });
      roleRepo.save.mockResolvedValue(ROLE);
      actionCatalog.find.mockResolvedValue([{ id: 100, code: 'VIEW_CUSTOMER' }]);

      await expect(service.updateRolePermissions(ROLE.id, tree(), 9)).resolves.toBeDefined();
    });

    it('lets SUPER_ADMIN keep them — the administrator role is never asked', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 1, roleName: 'SUPER_ADMIN', roleDescription: '', userCategoryId: 1 } as Role);
      roleRepo.save.mockResolvedValue({ id: 1, roleName: 'SUPER_ADMIN' });
      actionCatalog.find.mockResolvedValue([{ id: 100, code: 'CREATE_USER' }]);

      await expect(service.updateRolePermissions(1, tree({ roleName: 'SUPER_ADMIN' }), 9)).resolves.toBeDefined();
      expect(actionCatalog.find).not.toHaveBeenCalled();
    });
  });

  describe('the permission tree', () => {
    const adminSubModule = { id: 10, pModuleId: 1, code: 'USER_MANAGEMENT', name: 'Users', icon: null, url: null, displayOrder: 1 };
    const businessSubModule = { id: 11, pModuleId: 1, code: 'ATTRIBUTES', name: 'Attributes', icon: null, url: null, displayOrder: 5 };
    const adminScreen = { id: 20, subModuleId: 10, pModuleId: null, code: 'USER_LIST', name: 'Userslist', url: '/system-admin/users' };
    const actionRow = (id: number, code: string, screenId: number) => ({ id, code, name: code, screenId, parentActionId: null, displayOrder: id });

    // The tree service reads through its own injected repositories, so this block builds one with real find mocks.
    const buildTree = async (role: { id: number; roleName: string } | null) => {
      const repos = {
        rolePermission: { find: jest.fn().mockResolvedValue([]) },
        role: { findOne: jest.fn().mockResolvedValue(role) },
        subModule: { find: jest.fn().mockResolvedValue([adminSubModule, businessSubModule]) },
        action: { find: jest.fn().mockResolvedValue([actionRow(30, 'VIEW_USER', 20), actionRow(31, 'VIEW_CUSTOMER', 21)]) },
        pModule: { find: jest.fn().mockResolvedValue([{ id: 1, moduleName: 'System Admin', displayOrder: 99, icon: null, url: null, code: 'SYSTEM_ADMIN' }]) },
        screen: { find: jest.fn().mockResolvedValue([adminScreen, { id: 21, subModuleId: 11, pModuleId: null, code: 'ATTRIBUTES', name: 'Attributes', url: null }]) },
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          RolePermissionsService,
          { provide: getRepositoryToken(RolePermission), useValue: repos.rolePermission },
          { provide: getRepositoryToken(Role), useValue: repos.role },
          { provide: getRepositoryToken(SubModule), useValue: repos.subModule },
          { provide: getRepositoryToken(Action), useValue: repos.action },
          { provide: getRepositoryToken(PModule), useValue: repos.pModule },
          { provide: getRepositoryToken(Screen), useValue: repos.screen },
          { provide: DataSource, useValue: dataSource },
          { provide: AuditService, useValue: auditService },
          { provide: IamService, useValue: {} },
        ],
      }).compile();
      return moduleRef.get(RolePermissionsService);
    };

    const subModuleCodes = (result: Awaited<ReturnType<RolePermissionsService['getPermissionTree']>>) => result.screenPermissionList[0].subModule.map((subModule) => subModule.code);
    const actionCodes = (result: Awaited<ReturnType<RolePermissionsService['getPermissionTree']>>) =>
      result.screenPermissionList[0].subModule.flatMap((subModule) => subModule.screens.flatMap((screen) => screen.actions.map((action) => action.code)));

    it('the EDITOR\'s tree does not list the administration pages or permissions for an ordinary role', async () => {
      const result = await (await buildTree({ id: 7, roleName: 'Finance Reviewer' })).getPermissionTree(7, { forEditing: true });

      expect(subModuleCodes(result)).toEqual(['ATTRIBUTES']);
      expect(actionCodes(result)).toEqual(['VIEW_CUSTOMER']);
    });

    it('the EDITOR\'s tree does not list them for a role still being created (no role yet) either', async () => {
      const result = await (await buildTree(null)).getPermissionTree(undefined, { forEditing: true });

      expect(subModuleCodes(result)).toEqual(['ATTRIBUTES']);
    });

    it('lists everything for SUPER_ADMIN, in the editor too', async () => {
      const result = await (await buildTree({ id: 1, roleName: 'SUPER_ADMIN' })).getPermissionTree(1, { forEditing: true });

      expect(subModuleCodes(result)).toEqual(['USER_MANAGEMENT', 'ATTRIBUTES']);
      expect(actionCodes(result)).toEqual(['VIEW_USER', 'VIEW_CUSTOMER']);
    });

    // REGRESSION: the static navigation catalog (GET /auth/me/nav-catalog -> getAllMenus) is built from this tree for EVERY session. It once lost the
    // System Admin pages with the editor's filter, so the Users and Roles lists linked to "undefined/view/…" and every click ended in a 404.
    describe('everything that is NOT the editor keeps the whole structure', () => {
      it('the default tree is unfiltered, for an ordinary role and for no role', async () => {
        const service = await buildTree({ id: 7, roleName: 'Finance Reviewer' });
        expect(subModuleCodes(await service.getPermissionTree(7))).toEqual(['USER_MANAGEMENT', 'ATTRIBUTES']);
        expect(subModuleCodes(await (await buildTree(null)).getPermissionTree())).toEqual(['USER_MANAGEMENT', 'ATTRIBUTES']);
      });

      it('the navigation catalog (getAllMenus) lists the System Admin pages and their screens and actions — it is not role-specific', async () => {
        const [systemAdmin] = await (await buildTree(null)).getAllMenus();

        expect(systemAdmin.subModule.map((subModule) => subModule.code)).toEqual(['USER_MANAGEMENT', 'ATTRIBUTES']);
        // getAllMenus' own return type keeps only hasAccess on a screen; the rows still carry their codes.
        const adminScreens = systemAdmin.subModule[0].screens as unknown as Array<{ code: string; actions: Array<{ code: string }> }>;
        expect(adminScreens.map((screen) => screen.code)).toEqual(['USER_LIST']);
        expect(adminScreens[0].actions.map((action) => action.code)).toEqual(['VIEW_USER']);
      });
    });
  });
});
