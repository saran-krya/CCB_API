import { ExecutionContext } from '@nestjs/common';
import { OrganizationContextGuard } from './organization-context.guard';
import { OrganizationContextService } from './organization-context.service';

// Covers exactly what this guard is responsible for: reading organizationId off the
// already-live-resolved principal (JwtStrategy has already run) and writing it to the request's
// context — never an authorization decision, always returns true.
describe('OrganizationContextGuard', () => {
  let guard: OrganizationContextGuard;
  let context: { setOrganizationId: jest.Mock };

  beforeEach(() => {
    context = { setOrganizationId: jest.fn() };
    guard = new OrganizationContextGuard(context as unknown as OrganizationContextService);
  });

  function contextFor(user: unknown): ExecutionContext {
    return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
  }

  it('SUPER_ADMIN (organizationId null on the live-resolved principal) sets platform-level context', () => {
    const superAdmin = { sub: 1, email: 'root@ccb.local', type: 'staff', organizationId: null };

    expect(guard.canActivate(contextFor(superAdmin))).toBe(true);
    expect(context.setOrganizationId).toHaveBeenCalledWith(null);
  });

  it('Tenant ADMIN / any regular tenant staff user sets their real organizationId', () => {
    const tenantAdmin = { sub: 2, email: 'admin@acme.com', type: 'staff', organizationId: 42 };

    guard.canActivate(contextFor(tenantAdmin));
    expect(context.setOrganizationId).toHaveBeenCalledWith(42);
  });

  it('a Customer principal sets their own (denormalized) organizationId', () => {
    const customer = { sub: 9, email: 'resident@example.com', type: 'customer', organizationId: 7 };

    guard.canActivate(contextFor(customer));
    expect(context.setOrganizationId).toHaveBeenCalledWith(7);
  });

  it('no principal at all (an unauthenticated @Public() route) sets null, never throws', () => {
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
    expect(context.setOrganizationId).toHaveBeenCalledWith(null);
  });

  it('a principal missing organizationId entirely (e.g. a token issued before this claim existed) defaults to null, not undefined', () => {
    guard.canActivate(contextFor({ sub: 1, email: 'x@x.com', type: 'staff' }));
    expect(context.setOrganizationId).toHaveBeenCalledWith(null);
  });
});
