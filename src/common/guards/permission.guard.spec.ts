import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { Permission } from '../decorators/permission.decorator';
import { Roles } from '../decorators/roles.decorator';
import { Public } from '../decorators/public.decorator';
import { Authenticated } from '../decorators/authenticated.decorator';
import { CustomerAccessible } from '../decorators/customer-accessible.decorator';
import { RolePermissionsService } from '../../modules/role-permissions/role-permissions.service';

// Isolated tests for PermissionGuard: STAFF authorization is DENY-BY-DEFAULT (a route needs an explicit rule),
// and where the rule is @Permission, a user may hold several roles and is allowed iff ANY of their CURRENT roles
// grants ANY of the route's required action codes (additive union — see
// IamService.getActionCodesGrantedByPoliciesForRoles), resolved in ONE lookup. The roles come from
// principal.roleIds, which JwtStrategy re-reads from user_roles on every request; the guard must never let the
// singular roleId/roleName (a token-era claim) decide. Reads real decorator metadata off a probe controller
// through the real Reflector; only the role-permission lookup is mocked.
class ProbeController {
  @Permission('EDIT_THING')
  edit() {}

  @Permission('VIEW_THING', 'EDIT_THING')
  viewOrEdit() {}

  @Authenticated()
  selfService() {}

  @Roles('SUPER_ADMIN')
  rootOnly() {}

  @Public()
  login() {}

  @CustomerAccessible()
  customerPortalOnly() {}

  @CustomerAccessible()
  @Authenticated()
  sharedByStaffAndCustomers() {}

  /** A route nobody gave an authorization rule — the case deny-by-default exists for. */
  forgotten() {}
}

// Class-level rules are inherited by every route without its own (Nest's getAllAndOverride: handler first).
@Authenticated()
class OpenClassController {
  inherited() {}

  @Permission('EDIT_THING')
  stricter() {}
}

const ROLE_A = 11;
const ROLE_B = 22;

describe('PermissionGuard — deny-by-default, live multi-role authorization', () => {
  let guard: PermissionGuard;
  let rolesHaveAnyAction: jest.Mock;

  beforeEach(async () => {
    rolesHaveAnyAction = jest.fn().mockResolvedValue(false);
    const moduleRef = await Test.createTestingModule({
      providers: [PermissionGuard, { provide: RolePermissionsService, useValue: { rolesHaveAnyAction } }],
    }).compile();
    guard = moduleRef.get(PermissionGuard);
  });

  function contextFor(handlerName: string, user: unknown, controller: new () => object = ProbeController): ExecutionContext {
    return {
      getHandler: () => (controller.prototype as Record<string, () => void>)[handlerName],
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  /** Models rolesHaveAnyAction's real semantics: true iff ANY of the given roles grants ANY of the codes. */
  function grantsByRole(grants: Record<number, string[]>) {
    rolesHaveAnyAction.mockImplementation((roleIds: number[], codes: string[]) =>
      Promise.resolve(roleIds.some((roleId) => codes.some((code) => (grants[roleId] ?? []).includes(code)))),
    );
  }

  const staff = (overrides: Record<string, unknown> = {}) => ({
    sub: 1,
    email: 'staff@ccb.local',
    roleId: ROLE_A,
    roleName: 'ROLE_A',
    roleIds: [ROLE_A],
    roleNames: ['ROLE_A'],
    type: 'staff',
    ...overrides,
  });

  describe('every staff route needs an explicit authorization rule', () => {
    it('a route with NO rule is denied — a forgotten decorator can no longer expose an endpoint — and no lookup is made', async () => {
      expect(await guard.canActivate(contextFor('forgotten', staff()))).toBe(false);
      expect(rolesHaveAnyAction).not.toHaveBeenCalled();
    });

    it('@Authenticated is an explicit rule: any signed-in staff session passes, with no role lookup', async () => {
      expect(await guard.canActivate(contextFor('selfService', staff()))).toBe(true);
      expect(await guard.canActivate(contextFor('selfService', staff({ roleIds: [] })))).toBe(true);
      expect(rolesHaveAnyAction).not.toHaveBeenCalled();
    });

    it('@Authenticated still needs a signed-in principal — none at all is denied', async () => {
      expect(await guard.canActivate(contextFor('selfService', undefined))).toBe(false);
    });

    it('@Roles is an explicit rule: RolesGuard already enforced it earlier in the chain, so this guard lets it through', async () => {
      expect(await guard.canActivate(contextFor('rootOnly', staff()))).toBe(true);
      expect(rolesHaveAnyAction).not.toHaveBeenCalled();
    });

    it('a @Public route is never refused here, whether or not a principal is present', async () => {
      expect(await guard.canActivate(contextFor('login', undefined))).toBe(true);
      expect(await guard.canActivate(contextFor('login', staff()))).toBe(true);
    });

    it('a class-level @Authenticated covers its routes, and a route-level @Permission still applies on top', async () => {
      expect(await guard.canActivate(contextFor('inherited', staff(), OpenClassController))).toBe(true);
      grantsByRole({});
      expect(await guard.canActivate(contextFor('stricter', staff(), OpenClassController))).toBe(false);
    });
  });

  describe('customers and customer-portal routes', () => {
    const customer = { sub: 1, email: 'resident@example.com', type: 'customer' };

    it('a route marked ONLY @CustomerAccessible is a customer route: a customer passes (CustomerAccessGuard already decided) ...', async () => {
      expect(await guard.canActivate(contextFor('customerPortalOnly', customer))).toBe(true);
    });

    it('... and a STAFF session is denied on it — the customer portal is not a staff surface', async () => {
      expect(await guard.canActivate(contextFor('customerPortalOnly', staff()))).toBe(false);
    });

    it('a route that is both @CustomerAccessible and @Authenticated (shared self-service) admits staff and customers', async () => {
      expect(await guard.canActivate(contextFor('sharedByStaffAndCustomers', staff()))).toBe(true);
      expect(await guard.canActivate(contextFor('sharedByStaffAndCustomers', customer))).toBe(true);
    });

    it('a customer principal is denied on every @Permission route — even one that somehow carries staff role fields', async () => {
      grantsByRole({ [ROLE_A]: ['EDIT_THING'] });
      const sneaky = { ...customer, roleId: ROLE_A, roleIds: [ROLE_A] };

      expect(await guard.canActivate(contextFor('edit', sneaky))).toBe(false);
      expect(rolesHaveAnyAction).not.toHaveBeenCalled();
    });
  });

  describe('@Permission — principals that never reach a role lookup', () => {
    it('no principal at all is denied', async () => {
      expect(await guard.canActivate(contextFor('edit', undefined))).toBe(false);
      expect(rolesHaveAnyAction).not.toHaveBeenCalled();
    });
  });

  describe('ANY live role may grant the code (union across roles)', () => {
    it('roleIds [A, B] where ONLY the secondary role B grants the code is allowed — and the whole set is checked in ONE call', async () => {
      grantsByRole({ [ROLE_B]: ['EDIT_THING'] });

      const allowed = await guard.canActivate(contextFor('edit', staff({ roleIds: [ROLE_A, ROLE_B], roleNames: ['ROLE_A', 'ROLE_B'] })));

      expect(allowed).toBe(true);
      expect(rolesHaveAnyAction).toHaveBeenCalledTimes(1);
      expect(rolesHaveAnyAction).toHaveBeenCalledWith([ROLE_A, ROLE_B], ['EDIT_THING'], 1);
    });

    it('roleIds [A, B] where only the PRIMARY role A grants the code is allowed too — the primary is not special, nor is the secondary', async () => {
      grantsByRole({ [ROLE_A]: ['EDIT_THING'] });

      expect(await guard.canActivate(contextFor('edit', staff({ roleIds: [ROLE_A, ROLE_B] })))).toBe(true);
    });

    it('roleIds [A, B] where neither role grants the code is denied (deny by default)', async () => {
      grantsByRole({ [ROLE_A]: ['VIEW_THING'], [ROLE_B]: ['SOMETHING_ELSE'] });

      expect(await guard.canActivate(contextFor('edit', staff({ roleIds: [ROLE_A, ROLE_B] })))).toBe(false);
    });

    it('a role that lacks the code never takes it away from another role the user holds', async () => {
      grantsByRole({ [ROLE_B]: ['EDIT_THING'] }); // ROLE_A grants nothing at all

      expect(await guard.canActivate(contextFor('edit', staff({ roleIds: [ROLE_A, ROLE_B] })))).toBe(true);
      expect(await guard.canActivate(contextFor('edit', staff({ roleIds: [ROLE_B, ROLE_A] })))).toBe(true);
    });
  });

  describe('stale JWT claims never decide — only the live role set does', () => {
    it('principal.roleId is a stale claim (A) while the live roleIds are [B]: the decision follows B, never A', async () => {
      // A grants the code, B does not — if the stale singular claim leaked into the decision this would pass.
      grantsByRole({ [ROLE_A]: ['EDIT_THING'], [ROLE_B]: [] });
      const stale = staff({ roleId: ROLE_A, roleName: 'SUPER_ADMIN', roleIds: [ROLE_B], roleNames: ['ROLE_B'] });

      expect(await guard.canActivate(contextFor('edit', stale))).toBe(false);
      for (const [roleIds] of rolesHaveAnyAction.mock.calls) {
        expect(roleIds).toEqual([ROLE_B]);
        expect(roleIds).not.toContain(ROLE_A);
      }
    });

    it('...and the reverse: a role the user ONLY gained after the token was issued is honoured immediately', async () => {
      grantsByRole({ [ROLE_A]: [], [ROLE_B]: ['EDIT_THING'] });
      const staleToken = staff({ roleId: ROLE_A, roleName: 'ROLE_A', roleIds: [ROLE_B], roleNames: ['ROLE_B'] });

      expect(await guard.canActivate(contextFor('edit', staleToken))).toBe(true);
    });

    it('an EMPTY live role set is denied without any lookup — the singular roleId never stands in for it', async () => {
      grantsByRole({ [ROLE_A]: ['EDIT_THING'] });

      expect(await guard.canActivate(contextFor('edit', staff({ roleId: ROLE_A, roleIds: [], roleNames: [] })))).toBe(false);
      expect(rolesHaveAnyAction).not.toHaveBeenCalled();
    });

    it('falls back to [roleId] only for a principal built without roleIds at all', async () => {
      grantsByRole({ [ROLE_A]: ['EDIT_THING'] });
      const { roleIds: _roleIds, roleNames: _roleNames, ...withoutLiveSet } = staff();

      expect(await guard.canActivate(contextFor('edit', withoutLiveSet))).toBe(true);
      expect(rolesHaveAnyAction).toHaveBeenCalledWith([ROLE_A], ['EDIT_THING'], 1);
    });
  });

  describe("the user's own inline policies join the same check, keyed by the authenticated user id", () => {
    it('passes principal.sub with the role set on every lookup', async () => {
      grantsByRole({ [ROLE_A]: ['EDIT_THING'] });

      await guard.canActivate(contextFor('edit', staff({ sub: 42 })));

      expect(rolesHaveAnyAction).toHaveBeenCalledWith([ROLE_A], ['EDIT_THING'], 42);
    });

    it("a code granted ONLY by the user's own inline policy (no role grants it) is allowed — and never leaks to another user", async () => {
      // Models rolesHaveAnyAction(roleIds, codes, userId): true iff a role OR that user's inline policy grants one.
      rolesHaveAnyAction.mockImplementation((_roleIds: number[], codes: string[], userId?: number) =>
        Promise.resolve(userId === 42 && codes.includes('EDIT_THING')),
      );

      expect(await guard.canActivate(contextFor('edit', staff({ sub: 42 })))).toBe(true);
      expect(await guard.canActivate(contextFor('edit', staff({ sub: 43 })))).toBe(false);
    });
  });

  describe("ANY of the route's required action codes suffices — resolved in a single lookup", () => {
    it('holding only the second of two listed codes is enough', async () => {
      grantsByRole({ [ROLE_A]: ['EDIT_THING'] });

      expect(await guard.canActivate(contextFor('viewOrEdit', staff()))).toBe(true);
    });

    it('all listed codes go to ONE lookup call (not one query set per code)', async () => {
      grantsByRole({ [ROLE_A]: ['VIEW_THING'] });

      expect(await guard.canActivate(contextFor('viewOrEdit', staff()))).toBe(true);
      expect(rolesHaveAnyAction).toHaveBeenCalledTimes(1);
      expect(rolesHaveAnyAction).toHaveBeenCalledWith([ROLE_A], ['VIEW_THING', 'EDIT_THING'], 1);
    });

    it('the codes may come from DIFFERENT roles — any role granting any code', async () => {
      grantsByRole({ [ROLE_A]: [], [ROLE_B]: ['EDIT_THING'] });

      expect(await guard.canActivate(contextFor('viewOrEdit', staff({ roleIds: [ROLE_A, ROLE_B] })))).toBe(true);
    });

    it('holding none of the listed codes is denied', async () => {
      grantsByRole({ [ROLE_A]: ['SOMETHING_ELSE'] });

      expect(await guard.canActivate(contextFor('viewOrEdit', staff({ roleIds: [ROLE_A, ROLE_B] })))).toBe(false);
      expect(rolesHaveAnyAction).toHaveBeenCalledTimes(1);
    });
  });

  it('a failing permission lookup is never turned into an allow — the error propagates', async () => {
    rolesHaveAnyAction.mockRejectedValue(new Error('database unavailable'));

    await expect(guard.canActivate(contextFor('edit', staff()))).rejects.toThrow('database unavailable');
  });
});
