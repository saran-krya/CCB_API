import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PolicyController, RolePolicyController } from './policy.controller';
import { ResourceController } from './resource.controller';

// Isolated tests proving the privilege-escalation boundary required by the IAM migration: Policy and
// Resource administration (including attaching a Policy to a Role) must remain ADMINISTRATOR-only —
// the installation's own administrator: SUPER_ADMIN,
// and no other role — never relaxed, never made configurable via an ordinary @Permission grant (a
// Policy IS "what a role can do," so a lower-privileged role attaching a powerful Policy to itself
// would be a direct escalation path). Reads the REAL @Roles metadata via Reflector and exercises the
// REAL RolesGuard, never a hand-copied assumption about what's guarded.
describe('IAM controllers — administrator-only boundary', () => {
  let rolesGuard: RolesGuard;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [RolesGuard] }).compile();
    rolesGuard = moduleRef.get(RolesGuard);
  });

  function requiredRolesFor(controllerClass: Function): string[] | undefined {
    return Reflect.getMetadata(ROLES_KEY, controllerClass);
  }

  function mockContext(controllerClass: Function, handler: Function, roleName: string): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => controllerClass,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 1, roleId: 1, roleName, type: 'staff' } }) }),
    } as unknown as ExecutionContext;
  }

  it('PolicyController is class-level @Roles(SUPER_ADMIN) — the administrator role, nothing else (a delegated ADMIN is not on the list)', () => {
    expect(requiredRolesFor(PolicyController)).toEqual(['SUPER_ADMIN']);
  });

  it('ResourceController is class-level @Roles(SUPER_ADMIN)', () => {
    expect(requiredRolesFor(ResourceController)).toEqual(['SUPER_ADMIN']);
  });

  it('RolePolicyController (the Role<->Policy attach/detach surface) is class-level @Roles(SUPER_ADMIN)', () => {
    expect(requiredRolesFor(RolePolicyController)).toEqual(['SUPER_ADMIN']);
  });

  it.each(['SUPER_ADMIN'])('%s passes every IAM controller route', (administrator) => {
    expect(rolesGuard.canActivate(mockContext(PolicyController, PolicyController.prototype.create, administrator))).toBe(true);
    expect(rolesGuard.canActivate(mockContext(ResourceController, ResourceController.prototype.findAll, administrator))).toBe(true);
    expect(rolesGuard.canActivate(mockContext(RolePolicyController, RolePolicyController.prototype.attach, administrator))).toBe(true);
  });

  it.each(['FINANCE', 'CUSTOMER_SERVICE_SUPERVISOR', 'OPERATIONS', 'Cheif_Officer', 'ADMIN'])(
    'role "%s" is DENIED on PolicyController.create — the real privilege-escalation boundary (attaching a policy to itself requires SUPER_ADMIN, not just any staff role)',
    (roleName) => {
      expect(rolesGuard.canActivate(mockContext(PolicyController, PolicyController.prototype.create, roleName))).toBe(false);
    },
  );

  it.each(['FINANCE', 'CUSTOMER_SERVICE_SUPERVISOR', 'OPERATIONS', 'Cheif_Officer', 'ADMIN'])(
    'role "%s" is DENIED on RolePolicyController.attach — cannot attach a Policy to any Role',
    (roleName) => {
      expect(rolesGuard.canActivate(mockContext(RolePolicyController, RolePolicyController.prototype.attach, roleName))).toBe(false);
    },
  );

  it.each(['FINANCE', 'CUSTOMER_SERVICE_SUPERVISOR', 'OPERATIONS', 'Cheif_Officer', 'ADMIN'])(
    'role "%s" is DENIED on RolePolicyController.detach — cannot detach a Policy from any Role',
    (roleName) => {
      expect(rolesGuard.canActivate(mockContext(RolePolicyController, RolePolicyController.prototype.detach, roleName))).toBe(false);
    },
  );

  it.each(['SUPER_ADMIN'])('%s passes RolePolicyController.detach', (administrator) => {
    expect(rolesGuard.canActivate(mockContext(RolePolicyController, RolePolicyController.prototype.detach, administrator))).toBe(true);
  });

  it('an unauthorized request (no user at all, e.g. a bad/missing token) is denied on every IAM route', () => {
    const context = {
      getHandler: () => PolicyController.prototype.create,
      getClass: () => PolicyController,
      switchToHttp: () => ({ getRequest: () => ({ user: undefined }) }),
    } as unknown as ExecutionContext;

    expect(rolesGuard.canActivate(context)).toBe(false);
  });

  it('a customer-type principal is denied on every IAM route, even if it somehow carried roleName SUPER_ADMIN', () => {
    const context = {
      getHandler: () => PolicyController.prototype.create,
      getClass: () => PolicyController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 1, roleName: 'SUPER_ADMIN', type: 'customer' } }) }),
    } as unknown as ExecutionContext;

    expect(rolesGuard.canActivate(context)).toBe(false);
  });
});
