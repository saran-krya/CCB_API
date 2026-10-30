import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { Roles } from '../decorators/roles.decorator';

// Isolated tests for RolesGuard's multi-role, live-claim behavior. The decision uses the principal's
// LIVE role names (principal.roleNames, re-read from user_roles by JwtStrategy on every request): the
// SUPER_ADMIN bypass applies if ANY live role is SUPER_ADMIN — including as a SECONDARY role — and
// otherwise ANY live role must be one the route lists. The singular roleName (a token-era claim) must
// never decide. Reads real @Roles metadata off a probe controller through the real Reflector.
class ProbeController {
  @Roles('FINANCE', 'OPERATIONS')
  financeOrOperations() {}

  @Roles('SUPER_ADMIN')
  rootOnly() {}

  open() {}
}

describe('RolesGuard — live multi-role authorization', () => {
  let guard: RolesGuard;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [RolesGuard] }).compile();
    guard = moduleRef.get(RolesGuard);
  });

  function contextFor(handlerName: keyof ProbeController, user: unknown): ExecutionContext {
    return {
      getHandler: () => ProbeController.prototype[handlerName],
      getClass: () => ProbeController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  const staff = (roleNames: string[], overrides: Record<string, unknown> = {}) => ({
    sub: 1,
    email: 'staff@ccb.local',
    roleId: 1,
    roleName: roleNames[0],
    roleIds: roleNames.map((_name, index) => index + 1),
    roleNames,
    type: 'staff',
    ...overrides,
  });

  describe('routes and principals that bypass or fail outright', () => {
    it('a route with no required roles is allowed for anyone, even with no principal', () => {
      expect(guard.canActivate(contextFor('open', undefined))).toBe(true);
      expect(guard.canActivate(contextFor('open', staff(['FINANCE'])))).toBe(true);
    });

    it('no principal at all is denied on a @Roles route', () => {
      expect(guard.canActivate(contextFor('financeOrOperations', undefined))).toBe(false);
    });

    it('a customer principal is denied on every @Roles route — even one that carries SUPER_ADMIN role fields', () => {
      const customer = { sub: 1, email: 'resident@example.com', type: 'customer', roleName: 'SUPER_ADMIN', roleNames: ['SUPER_ADMIN'] };

      expect(guard.canActivate(contextFor('rootOnly', customer))).toBe(false);
      expect(guard.canActivate(contextFor('financeOrOperations', customer))).toBe(false);
    });
  });

  describe('SUPER_ADMIN bypass', () => {
    it('SUPER_ADMIN as the only role bypasses every @Roles route', () => {
      expect(guard.canActivate(contextFor('financeOrOperations', staff(['SUPER_ADMIN'])))).toBe(true);
      expect(guard.canActivate(contextFor('rootOnly', staff(['SUPER_ADMIN'])))).toBe(true);
    });

    it('SUPER_ADMIN held as a SECONDARY role still bypasses, including on a route listing none of the user\'s other roles', () => {
      const user = staff(['CUSTOMER_SUPPORT', 'SUPER_ADMIN']);

      expect(guard.canActivate(contextFor('financeOrOperations', user))).toBe(true);
      expect(guard.canActivate(contextFor('rootOnly', user))).toBe(true);
    });

    it('without SUPER_ADMIN among the live roles there is no bypass', () => {
      expect(guard.canActivate(contextFor('rootOnly', staff(['FINANCE', 'OPERATIONS'])))).toBe(false);
    });
  });

  describe('a listed role may be held as any of the user\'s roles', () => {
    it('a required role held as the PRIMARY role passes', () => {
      expect(guard.canActivate(contextFor('financeOrOperations', staff(['FINANCE', 'CUSTOMER_SUPPORT'])))).toBe(true);
    });

    it('a required role held as a SECONDARY role passes', () => {
      expect(guard.canActivate(contextFor('financeOrOperations', staff(['CUSTOMER_SUPPORT', 'OPERATIONS'])))).toBe(true);
    });

    it('none of the live roles is listed — denied', () => {
      expect(guard.canActivate(contextFor('financeOrOperations', staff(['CUSTOMER_SUPPORT', 'BILLING'])))).toBe(false);
    });

    it('role names match exactly — no case folding, no substring match', () => {
      expect(guard.canActivate(contextFor('financeOrOperations', staff(['operations'])))).toBe(false);
      expect(guard.canActivate(contextFor('financeOrOperations', staff(['OPERATIONS_LEAD'])))).toBe(false);
      expect(guard.canActivate(contextFor('rootOnly', staff(['super_admin'])))).toBe(false);
    });
  });

  describe('stale JWT claims never decide — only the live role set does', () => {
    it('a stale SUPER_ADMIN claim (user demoted since the token was issued) grants nothing: singular roleName SUPER_ADMIN, live roleNames [FINANCE]', () => {
      const demoted = staff(['FINANCE'], { roleName: 'SUPER_ADMIN' });

      expect(guard.canActivate(contextFor('rootOnly', demoted))).toBe(false);
      expect(guard.canActivate(contextFor('financeOrOperations', demoted))).toBe(true); // FINANCE is live
    });

    it('a SUPER_ADMIN role gained after the token was issued is honoured at once: singular roleName FINANCE, live roleNames [FINANCE, SUPER_ADMIN]', () => {
      const promoted = staff(['FINANCE', 'SUPER_ADMIN'], { roleName: 'FINANCE' });

      expect(guard.canActivate(contextFor('rootOnly', promoted))).toBe(true);
    });

    it('an EMPTY live role set is denied — the singular roleName never stands in for it, not even SUPER_ADMIN', () => {
      const roleless = staff([], { roleName: 'SUPER_ADMIN', roleId: 1 });

      expect(guard.canActivate(contextFor('rootOnly', roleless))).toBe(false);
      expect(guard.canActivate(contextFor('financeOrOperations', roleless))).toBe(false);
    });

    it('falls back to [roleName] only for a principal built without roleNames at all', () => {
      const withoutLiveSet = (roleName: string) => ({ sub: 1, email: 'staff@ccb.local', roleId: 1, roleName, type: 'staff' });

      expect(guard.canActivate(contextFor('financeOrOperations', withoutLiveSet('OPERATIONS')))).toBe(true);
      expect(guard.canActivate(contextFor('financeOrOperations', withoutLiveSet('SUPER_ADMIN')))).toBe(true);
      expect(guard.canActivate(contextFor('financeOrOperations', withoutLiveSet('BILLING')))).toBe(false);
    });
  });
});
