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
// metadata (not a hand-copied assumption) and exercises the real PermissionGuard. The same file also
// pins the two role-assignment routes (POST/DELETE /users/:id/roles) to EDIT_USER — they are the
// only way to change a user's roles, so a drift to a weaker (or missing) permission would be a
// privilege-escalation hole.
describe('UserController authorization', () => {
  let guard: PermissionGuard;
  let rolesHaveAction: jest.Mock;

  beforeEach(async () => {
    rolesHaveAction = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [PermissionGuard, { provide: RolePermissionsService, useValue: { rolesHaveAction } }],
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
        getRequest: () => ({
          user: { sub: roleId, roleId, roleName: 'TEST_ROLE', roleIds: [roleId], roleNames: ['TEST_ROLE'], type: 'staff' },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  /** The guard asks about the user's live role set: true iff ANY of those roles grants the code. */
  function onlyGrants(...codes: string[]) {
    rolesHaveAction.mockImplementation((_roleIds: number[], c: string) => Promise.resolve(codes.includes(c)));
  }

  describe('getReportingManagers', () => {
    it('now carries @Permission(CREATE_USER, EDIT_USER) — same screens (UserForm) that reach it', () => {
      expect(requiredCodesFor('getReportingManagers')).toEqual(['CREATE_USER', 'EDIT_USER']);
    });

    it('getFieldInspectors remains unchanged at @Permission(BILLING_READINESS_VIEW)', () => {
      expect(requiredCodesFor('getFieldInspectors')).toEqual(['BILLING_READINESS_VIEW']);
    });

    it('a role holding CREATE_USER is allowed through PermissionGuard for getReportingManagers', async () => {
      onlyGrants('CREATE_USER');
      expect(await guard.canActivate(mockContext('getReportingManagers'))).toBe(true);
    });

    it('a role holding EDIT_USER is allowed through PermissionGuard for getReportingManagers', async () => {
      onlyGrants('EDIT_USER');
      expect(await guard.canActivate(mockContext('getReportingManagers'))).toBe(true);
    });

    it('a role holding neither CREATE_USER nor EDIT_USER is DENIED by PermissionGuard for getReportingManagers — the fixed gap', async () => {
      rolesHaveAction.mockResolvedValue(false);
      expect(await guard.canActivate(mockContext('getReportingManagers'))).toBe(false);
    });
  });

  describe('role assignment routes (POST/DELETE /users/:id/roles)', () => {
    it.each(['addRoles', 'removeRole'] as const)('%s requires EDIT_USER — and only EDIT_USER', (handler) => {
      expect(requiredCodesFor(handler)).toEqual(['EDIT_USER']);
    });

    it.each(['addRoles', 'removeRole'] as const)('%s is allowed for a role holding EDIT_USER', async (handler) => {
      onlyGrants('EDIT_USER');
      expect(await guard.canActivate(mockContext(handler))).toBe(true);
    });

    it.each(['addRoles', 'removeRole'] as const)(
      '%s is DENIED for a role holding other user permissions (VIEW_USER, CREATE_USER, DELETE_USER) but not EDIT_USER',
      async (handler) => {
        onlyGrants('VIEW_USER', 'CREATE_USER', 'DELETE_USER');
        expect(await guard.canActivate(mockContext(handler))).toBe(false);
      },
    );

    it('updating a user (PATCH /users/:id) still needs EDIT_USER too — role changes are not reachable through a weaker permission than profile edits', () => {
      expect(requiredCodesFor('update')).toEqual(['EDIT_USER']);
    });
  });
});
