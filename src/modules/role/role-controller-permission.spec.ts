import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSION_KEY } from '../../common/decorators/permission.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { RoleController } from './role.controller';
import { rolePermissionsMock } from '../../../test/helpers/role-permissions.mock';

// Role routes are authorized by PERMISSION only. The controller used to ALSO carry a class-level role-NAME gate —
// a gate on a name that no role was actually called, so the routes were reachable by SUPER_ADMIN alone whatever
// VIEW_ROLE/CREATE_ROLE/EDIT_ROLE/DELETE_ROLE were granted, and the authority of a role hung on a string that
// could be created or renamed. The name gate is gone; what protects the one predefined role now lives in
// RoleService (the reserved SUPER_ADMIN name, SUPER_ADMIN-only edits). The role names used
// as fixtures below are arbitrary: every role other than SUPER_ADMIN is created dynamically and no name is special.
// This suite pins the controller side: no name-based gate, an explicit @Permission on EVERY route, and
// PermissionGuard genuinely enforcing the matching code.
describe('RoleController authorization', () => {
  let guard: PermissionGuard;
  let rolesHaveAction: jest.Mock;

  beforeEach(async () => {
    rolesHaveAction = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [PermissionGuard, { provide: RolePermissionsService, useValue: rolePermissionsMock(rolesHaveAction) }],
    }).compile();
    guard = moduleRef.get(PermissionGuard);
  });

  function requiredCodesFor(methodName: keyof RoleController): string[] | undefined {
    return Reflect.getMetadata(PERMISSION_KEY, RoleController.prototype[methodName]);
  }

  function mockContext(methodName: keyof RoleController, roleId = 99, roleName = 'TEST_ROLE'): ExecutionContext {
    const handler = RoleController.prototype[methodName];
    return {
      getHandler: () => handler,
      getClass: () => RoleController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: roleId, roleId, roleName, roleIds: [roleId], roleNames: [roleName], type: 'staff' } }),
      }),
    } as unknown as ExecutionContext;
  }

  it('has NO class-level or route-level @Roles — a role NAME can no longer grant or deny access to the role routes', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RoleController)).toBeUndefined();
    for (const name of Object.getOwnPropertyNames(RoleController.prototype)) {
      if (name === 'constructor') continue;
      expect(Reflect.getMetadata(ROLES_KEY, RoleController.prototype[name as keyof RoleController])).toBeUndefined();
    }
  });

  it('EVERY route handler declares an explicit @Permission (deny-by-default has nothing left to deny)', () => {
    const handlers = Object.getOwnPropertyNames(RoleController.prototype).filter((name) => name !== 'constructor');
    expect(handlers.length).toBeGreaterThan(0);
    for (const name of handlers) {
      const codes = requiredCodesFor(name as keyof RoleController);
      expect({ handler: name, hasRule: Array.isArray(codes) && codes.length > 0 }).toEqual({ handler: name, hasRule: true });
    }
  });

  it.each([
    ['create', 'CREATE_ROLE'],
    ['findAll', 'VIEW_ROLE'],
    ['findOne', 'VIEW_ROLE'],
    ['findOneWithDetails', 'VIEW_ROLE'],
    ['update', 'EDIT_ROLE'],
    ['remove', 'DELETE_ROLE'],
  ] as const)('%s carries exactly @Permission(%s)', (methodName, expectedCode) => {
    expect(requiredCodesFor(methodName)).toEqual([expectedCode]);
  });

  it.each(['getRoleDropdown', 'getRolePicker', 'getRoleFilter', 'getFilterMetadata'] as const)(
    '%s serves the role pickers: allowed by VIEW_ROLE or by the user-management permissions that need a role list',
    (methodName) => {
      expect(requiredCodesFor(methodName)).toEqual(['VIEW_ROLE', 'CREATE_USER', 'EDIT_USER']);
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
    'a role holding none of the required codes is denied by PermissionGuard for %s',
    async (methodName) => {
      rolesHaveAction.mockResolvedValue(false);
      expect(await guard.canActivate(mockContext(methodName))).toBe(false);
    },
  );

  it.each(['getRoleDropdown', 'getRolePicker', 'getRoleFilter', 'getFilterMetadata'] as const)(
    'a user who can only create/edit users (no VIEW_ROLE) may still load %s for the role picker — and one with neither is denied',
    async (methodName) => {
      rolesHaveAction.mockImplementation((_roleIds: number[], c: string) => Promise.resolve(c === 'CREATE_USER'));
      expect(await guard.canActivate(mockContext(methodName))).toBe(true);

      rolesHaveAction.mockImplementation((_roleIds: number[], c: string) => Promise.resolve(c === 'DELETE_ROLE'));
      expect(await guard.canActivate(mockContext(methodName))).toBe(false);
    },
  );

  it('SUPER_ADMIN real grant combination (holds all four codes via its system policy) passes every guarded route', async () => {
    const heldCodes = new Set(['VIEW_ROLE', 'CREATE_ROLE', 'EDIT_ROLE', 'DELETE_ROLE']);
    rolesHaveAction.mockImplementation((_roleIds: number[], c: string) => Promise.resolve(heldCodes.has(c)));

    for (const methodName of ['create', 'findAll', 'findOne', 'findOneWithDetails', 'update', 'remove'] as const) {
      expect(await guard.canActivate(mockContext(methodName))).toBe(true);
    }
  });

  it('the decision follows the permission, never the role NAME: any role granted the code passes, a role literally named ADMIN without it does not', async () => {
    const heldCodes = new Set(['VIEW_ROLE']);
    rolesHaveAction.mockImplementation((_roleIds: number[], c: string) => Promise.resolve(heldCodes.has(c)));

    expect(await guard.canActivate(mockContext('findAll', 7, 'CUSTOMER_SERVICE_SUPERVISOR'))).toBe(true);
    expect(await guard.canActivate(mockContext('create', 8, 'ADMIN'))).toBe(false);
  });
});

describe('RoleController RolesGuard — nothing name-based is left on the controller', () => {
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

  it.each(['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE_SUPERVISOR'])(
    'RolesGuard has no role requirement to apply here, so it never decides for %s — PermissionGuard does',
    (roleName) => {
      expect(rolesGuard.canActivate(mockContext(roleName))).toBe(true);
    },
  );
});
