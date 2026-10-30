import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSION_KEY } from '../../common/decorators/permission.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { RoleController } from './role.controller';

// Isolated tests for the RBAC remediation fix: VIEW_ROLE/CREATE_ROLE/EDIT_ROLE/DELETE_ROLE were
// seeded, shown in the ACL editor, and referenced by the frontend's usePermission() gates, but the
// backend never actually checked them — role.controller.ts enforced only the coarse, class-level
// @Roles(ROLES.ADMIN), making these four grant/revoke checkboxes cosmetic. @Permission decorators
// now exist alongside (never instead of) @Roles — both guards still run (AND composition, per
// AuthModule's APP_GUARD chain), so this suite confirms BOTH that @Roles(ADMIN) is unchanged AND
// that PermissionGuard now genuinely enforces the matching code on each route.
describe('RoleController authorization', () => {
  let guard: PermissionGuard;
  let rolesHaveAction: jest.Mock;

  beforeEach(async () => {
    rolesHaveAction = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [PermissionGuard, { provide: RolePermissionsService, useValue: { rolesHaveAction } }],
    }).compile();
    guard = moduleRef.get(PermissionGuard);
  });

  function requiredCodesFor(methodName: keyof RoleController): string[] | undefined {
    return Reflect.getMetadata(PERMISSION_KEY, RoleController.prototype[methodName]);
  }

  function mockContext(methodName: keyof RoleController, roleId = 99): ExecutionContext {
    const handler = RoleController.prototype[methodName];
    return {
      getHandler: () => handler,
      getClass: () => RoleController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: roleId, roleId, roleName: 'TEST_ROLE', roleIds: [roleId], roleNames: ['TEST_ROLE'], type: 'staff' } }),
      }),
    } as unknown as ExecutionContext;
  }

  it('class-level @Roles(ROLES.ADMIN) is unchanged', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, RoleController);
    expect(roles).toEqual(['ADMIN']);
  });

  it.each([
    ['create', 'CREATE_ROLE'],
    ['findAll', 'VIEW_ROLE'],
    ['findOne', 'VIEW_ROLE'],
    ['findOneWithDetails', 'VIEW_ROLE'],
    ['update', 'EDIT_ROLE'],
    ['remove', 'DELETE_ROLE'],
  ] as const)('%s now carries @Permission(%s)', (methodName, expectedCode) => {
    expect(requiredCodesFor(methodName)).toEqual([expectedCode]);
  });

  it.each(['getRoleDropdown', 'getRoleFilter', 'getFilterMetadata'] as const)(
    '%s intentionally has NO @Permission — used by other forms (e.g. UserForm) to populate a role picker, not a role-management action',
    (methodName) => {
      expect(requiredCodesFor(methodName)).toBeUndefined();
    },
  );

  it.each([
    ['create', 'CREATE_ROLE'],
    ['findAll', 'VIEW_ROLE'],
    ['update', 'EDIT_ROLE'],
    ['remove', 'DELETE_ROLE'],
  ] as const)('a role holding %s is allowed through PermissionGuard for %s', async (methodName, code) => {
    rolesHaveAction.mockImplementation((_roleIds: number[], c: string) => Promise.resolve(c === code));
    expect(await guard.canActivate(mockContext(methodName))).toBe(true);
  });

  it.each(['create', 'findAll', 'update', 'remove'] as const)(
    'a role holding none of the required codes is denied by PermissionGuard for %s (RolesGuard alone is no longer sufficient)',
    async (methodName) => {
      rolesHaveAction.mockResolvedValue(false);
      expect(await guard.canActivate(mockContext(methodName))).toBe(false);
    },
  );

  it('SUPER_ADMIN real grant combination (holds all four codes via ensureAdminGrants) passes every guarded route', async () => {
    const heldCodes = new Set(['VIEW_ROLE', 'CREATE_ROLE', 'EDIT_ROLE', 'DELETE_ROLE']);
    rolesHaveAction.mockImplementation((_roleIds: number[], c: string) => Promise.resolve(heldCodes.has(c)));

    for (const methodName of ['create', 'findAll', 'findOne', 'findOneWithDetails', 'update', 'remove'] as const) {
      expect(await guard.canActivate(mockContext(methodName))).toBe(true);
    }
  });
});

describe('RoleController RolesGuard — unchanged by this fix', () => {
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [RolesGuard] }).compile();
    rolesGuard = moduleRef.get(RolesGuard);
  });

  function mockContext(roleName: string): ExecutionContext {
    return {
      getHandler: () => RoleController.prototype.create,
      getClass: () => RoleController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 1, roleId: 1, roleName, type: 'staff' } }) }),
    } as unknown as ExecutionContext;
  }

  it('SUPER_ADMIN always bypasses @Roles(ADMIN), as before', () => {
    expect(rolesGuard.canActivate(mockContext('SUPER_ADMIN'))).toBe(true);
  });

  it('a role literally named ADMIN still passes @Roles(ADMIN), as before', () => {
    expect(rolesGuard.canActivate(mockContext('ADMIN'))).toBe(true);
  });

  it('any other role name is still denied by @Roles(ADMIN), as before', () => {
    expect(rolesGuard.canActivate(mockContext('CUSTOMER_SERVICE_SUPERVISOR'))).toBe(false);
  });
});
