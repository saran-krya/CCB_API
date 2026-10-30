import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { Permission } from '../decorators/permission.decorator';
import { RolePermissionsService } from '../../modules/role-permissions/role-permissions.service';

// Isolated tests for PermissionGuard's multi-role, live-claim behavior. A user may hold several roles
// and is allowed iff ANY of their CURRENT roles grants ANY of the route's required action codes
// (additive union — see IamService.getActionCodesGrantedByPoliciesForRoles). The roles come from
// principal.roleIds, which JwtStrategy re-reads from user_roles on every request; the guard must never
// let the singular roleId/roleName (a token-era claim) decide. Reads real @Permission metadata off a
// probe controller through the real Reflector; only the role-permission lookup is mocked.
class ProbeController {
  @Permission('EDIT_THING')
  edit() {}

  @Permission('VIEW_THING', 'EDIT_THING')
  viewOrEdit() {}

  open() {}
}

const ROLE_A = 11;
const ROLE_B = 22;

describe('PermissionGuard — live multi-role authorization', () => {
  let guard: PermissionGuard;
  let rolesHaveAction: jest.Mock;

  beforeEach(async () => {
    rolesHaveAction = jest.fn().mockResolvedValue(false);
    const moduleRef = await Test.createTestingModule({
      providers: [PermissionGuard, { provide: RolePermissionsService, useValue: { rolesHaveAction } }],
    }).compile();
    guard = moduleRef.get(PermissionGuard);
  });

  function contextFor(handlerName: keyof ProbeController, user: unknown): ExecutionContext {
    return {
      getHandler: () => ProbeController.prototype[handlerName],
      getClass: () => ProbeController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  /** Models rolesHaveAction's real semantics: true iff ANY of the given roles grants the code. */
  function grantsByRole(grants: Record<number, string[]>) {
    rolesHaveAction.mockImplementation((roleIds: number[], code: string) =>
      Promise.resolve(roleIds.some((roleId) => (grants[roleId] ?? []).includes(code))),
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

  describe('routes and principals that never reach a role lookup', () => {
    it('a route with no required action codes is allowed without any lookup', async () => {
      expect(await guard.canActivate(contextFor('open', staff()))).toBe(true);
      expect(await guard.canActivate(contextFor('open', undefined))).toBe(true);
      expect(rolesHaveAction).not.toHaveBeenCalled();
    });

    it('no principal at all is denied', async () => {
      expect(await guard.canActivate(contextFor('edit', undefined))).toBe(false);
      expect(rolesHaveAction).not.toHaveBeenCalled();
    });

    it('a customer principal is denied on every guarded route — even one that somehow carries staff role fields', async () => {
      grantsByRole({ [ROLE_A]: ['EDIT_THING'] });
      const customer = { sub: 1, email: 'resident@example.com', type: 'customer', roleId: ROLE_A, roleIds: [ROLE_A] };

      expect(await guard.canActivate(contextFor('edit', customer))).toBe(false);
      expect(rolesHaveAction).not.toHaveBeenCalled();
    });
  });

  describe('ANY live role may grant the code (union across roles)', () => {
    it('roleIds [A, B] where ONLY the secondary role B grants the code is allowed — and the whole set is checked in ONE call', async () => {
      grantsByRole({ [ROLE_B]: ['EDIT_THING'] });

      const allowed = await guard.canActivate(contextFor('edit', staff({ roleIds: [ROLE_A, ROLE_B], roleNames: ['ROLE_A', 'ROLE_B'] })));

      expect(allowed).toBe(true);
      expect(rolesHaveAction).toHaveBeenCalledTimes(1);
      expect(rolesHaveAction).toHaveBeenCalledWith([ROLE_A, ROLE_B], 'EDIT_THING', 1);
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
      for (const [roleIds] of rolesHaveAction.mock.calls) {
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
      expect(rolesHaveAction).not.toHaveBeenCalled();
    });

    it('falls back to [roleId] only for a principal built without roleIds at all', async () => {
      grantsByRole({ [ROLE_A]: ['EDIT_THING'] });
      const { roleIds: _roleIds, roleNames: _roleNames, ...withoutLiveSet } = staff();

      expect(await guard.canActivate(contextFor('edit', withoutLiveSet))).toBe(true);
      expect(rolesHaveAction).toHaveBeenCalledWith([ROLE_A], 'EDIT_THING', 1);
    });
  });

  describe("the user's own inline policies join the same check, keyed by the authenticated user id", () => {
    it('passes principal.sub with the role set on every lookup', async () => {
      grantsByRole({ [ROLE_A]: ['EDIT_THING'] });

      await guard.canActivate(contextFor('edit', staff({ sub: 42 })));

      expect(rolesHaveAction).toHaveBeenCalledWith([ROLE_A], 'EDIT_THING', 42);
    });

    it("a code granted ONLY by the user's own inline policy (no role grants it) is allowed — and never leaks to another user", async () => {
      // Models rolesHaveAction(roleIds, code, userId): true iff a role OR that user's inline policy grants it.
      rolesHaveAction.mockImplementation((_roleIds: number[], code: string, userId?: number) =>
        Promise.resolve(userId === 42 && code === 'EDIT_THING'),
      );

      expect(await guard.canActivate(contextFor('edit', staff({ sub: 42 })))).toBe(true);
      expect(await guard.canActivate(contextFor('edit', staff({ sub: 43 })))).toBe(false);
    });
  });

  describe('ANY of the route\'s required action codes suffices', () => {
    it('holding only the second of two listed codes is enough', async () => {
      grantsByRole({ [ROLE_A]: ['EDIT_THING'] });

      expect(await guard.canActivate(contextFor('viewOrEdit', staff()))).toBe(true);
    });

    it('holding only the first of two listed codes is enough, and the second is not even looked up', async () => {
      grantsByRole({ [ROLE_A]: ['VIEW_THING'] });

      expect(await guard.canActivate(contextFor('viewOrEdit', staff()))).toBe(true);
      expect(rolesHaveAction).toHaveBeenCalledTimes(1);
      expect(rolesHaveAction).toHaveBeenCalledWith([ROLE_A], 'VIEW_THING', 1);
    });

    it('the codes may come from DIFFERENT roles — any role granting any code', async () => {
      grantsByRole({ [ROLE_A]: [], [ROLE_B]: ['EDIT_THING'] });

      expect(await guard.canActivate(contextFor('viewOrEdit', staff({ roleIds: [ROLE_A, ROLE_B] })))).toBe(true);
    });

    it('holding none of the listed codes is denied after every code was checked against the whole role set', async () => {
      grantsByRole({ [ROLE_A]: ['SOMETHING_ELSE'] });

      expect(await guard.canActivate(contextFor('viewOrEdit', staff({ roleIds: [ROLE_A, ROLE_B] })))).toBe(false);
      expect(rolesHaveAction).toHaveBeenCalledTimes(2);
      expect(rolesHaveAction).toHaveBeenNthCalledWith(1, [ROLE_A, ROLE_B], 'VIEW_THING', 1);
      expect(rolesHaveAction).toHaveBeenNthCalledWith(2, [ROLE_A, ROLE_B], 'EDIT_THING', 1);
    });
  });

  it('a failing permission lookup is never turned into an allow — the error propagates', async () => {
    rolesHaveAction.mockRejectedValue(new Error('database unavailable'));

    await expect(guard.canActivate(contextFor('edit', staff()))).rejects.toThrow('database unavailable');
  });
});
