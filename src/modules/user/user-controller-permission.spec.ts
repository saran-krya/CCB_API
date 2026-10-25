import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSION_KEY } from '../../common/decorators/permission.decorator';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { UserController } from './user.controller';

// Isolated tests for the authorization gap found during the Policy-based RBAC audit:
// GET /users/reporting-managers had NO guard at all (any authenticated staff member, any role,
// could list every reporting-manager-capable user's name/employee code/role) — unlike its sibling
// GET /users/field-inspectors, which was already correctly gated. Confirms the real @Permission
// metadata (not a hand-copied assumption) and exercises the real PermissionGuard.
describe('UserController.getReportingManagers authorization', () => {
  let guard: PermissionGuard;
  let roleHasAction: jest.Mock;

  beforeEach(async () => {
    roleHasAction = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [PermissionGuard, { provide: RolePermissionsService, useValue: { roleHasAction } }],
    }).compile();
    guard = moduleRef.get(PermissionGuard);
  });

  function requiredCodesFor(methodName: keyof UserController): string[] | undefined {
    return Reflect.getMetadata(PERMISSION_KEY, UserController.prototype[methodName]);
  }

  function mockContext(methodName: keyof UserController, roleId = 99): ExecutionContext {
    const handler = UserController.prototype[methodName];
    return {
      getHandler: () => handler,
      getClass: () => UserController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: roleId, roleId, roleName: 'TEST_ROLE', type: 'staff' } }),
      }),
    } as unknown as ExecutionContext;
  }

  it('getReportingManagers now carries @Permission(CREATE_USER, EDIT_USER) — same screens (UserForm) that reach it', () => {
    expect(requiredCodesFor('getReportingManagers')).toEqual(['CREATE_USER', 'EDIT_USER']);
  });

  it('getFieldInspectors remains unchanged at @Permission(BILLING_READINESS_VIEW)', () => {
    expect(requiredCodesFor('getFieldInspectors')).toEqual(['BILLING_READINESS_VIEW']);
  });

  it('a role holding CREATE_USER is allowed through PermissionGuard for getReportingManagers', async () => {
    roleHasAction.mockImplementation((_roleId: number, c: string) => Promise.resolve(c === 'CREATE_USER'));
    expect(await guard.canActivate(mockContext('getReportingManagers'))).toBe(true);
  });

  it('a role holding EDIT_USER is allowed through PermissionGuard for getReportingManagers', async () => {
    roleHasAction.mockImplementation((_roleId: number, c: string) => Promise.resolve(c === 'EDIT_USER'));
    expect(await guard.canActivate(mockContext('getReportingManagers'))).toBe(true);
  });

  it('a role holding neither CREATE_USER nor EDIT_USER is DENIED by PermissionGuard for getReportingManagers — the fixed gap', async () => {
    roleHasAction.mockResolvedValue(false);
    expect(await guard.canActivate(mockContext('getReportingManagers'))).toBe(false);
  });
});
