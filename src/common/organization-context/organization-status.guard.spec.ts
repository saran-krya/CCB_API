import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { OrganizationStatusGuard } from './organization-status.guard';
import { OrganizationContextService } from './organization-context.service';
import { OrganizationService } from '../../modules/organization/organization.service';
import { OrganizationStatus } from '../../modules/organization/entities/organization.entity';
import { Public } from '../decorators/public.decorator';
import { AllowSuspendedOrg } from '../decorators/allow-suspended-org.decorator';

// Real @Public()/@AllowSuspendedOrg() metadata, read through a real Reflector — same convention as
// roles.guard.spec.ts — with OrganizationContextService/OrganizationService mocked.
class ProbeController {
  @Public()
  publicRoute() {}

  @AllowSuspendedOrg()
  allowedWhileSuspended() {}

  ordinaryRoute() {}
}

describe('OrganizationStatusGuard', () => {
  let guard: OrganizationStatusGuard;
  let context: { getOrganizationId: jest.Mock };
  let organizations: { findOneEntity: jest.Mock };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [Reflector] }).compile();
    const reflector = moduleRef.get(Reflector);

    context = { getOrganizationId: jest.fn() };
    organizations = { findOneEntity: jest.fn() };
    guard = new OrganizationStatusGuard(context as unknown as OrganizationContextService, organizations as unknown as OrganizationService, reflector);
  });

  function contextFor(handlerName: keyof ProbeController): ExecutionContext {
    return {
      getHandler: () => ProbeController.prototype[handlerName],
      getClass: () => ProbeController,
    } as unknown as ExecutionContext;
  }

  it('SUPER_ADMIN (null organization context) always passes, without even loading an organization', async () => {
    context.getOrganizationId.mockReturnValue(null);

    await expect(guard.canActivate(contextFor('ordinaryRoute'))).resolves.toBe(true);
    expect(organizations.findOneEntity).not.toHaveBeenCalled();
  });

  it('Tenant ADMIN / regular tenant user in an ACTIVE organization passes', async () => {
    context.getOrganizationId.mockReturnValue(5);
    organizations.findOneEntity.mockResolvedValue({ id: 5, status: OrganizationStatus.ACTIVE });

    await expect(guard.canActivate(contextFor('ordinaryRoute'))).resolves.toBe(true);
  });

  it.each([OrganizationStatus.SUSPENDED, OrganizationStatus.INACTIVE, OrganizationStatus.PENDING])(
    'a tenant session whose organization is %s is denied on an ordinary route',
    async (status) => {
      context.getOrganizationId.mockReturnValue(5);
      organizations.findOneEntity.mockResolvedValue({ id: 5, status });

      await expect(guard.canActivate(contextFor('ordinaryRoute'))).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('a Customer principal in a SUSPENDED organization is denied the same way a staff session is', async () => {
    context.getOrganizationId.mockReturnValue(5);
    organizations.findOneEntity.mockResolvedValue({ id: 5, status: OrganizationStatus.SUSPENDED });

    await expect(guard.canActivate(contextFor('ordinaryRoute'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an @AllowSuspendedOrg() route is still reachable while the organization is suspended', async () => {
    context.getOrganizationId.mockReturnValue(5);
    organizations.findOneEntity.mockResolvedValue({ id: 5, status: OrganizationStatus.SUSPENDED });

    await expect(guard.canActivate(contextFor('allowedWhileSuspended'))).resolves.toBe(true);
  });

  it('a @Public() route is reachable regardless of organization status, without loading one', async () => {
    context.getOrganizationId.mockReturnValue(5);

    await expect(guard.canActivate(contextFor('publicRoute'))).resolves.toBe(true);
    expect(organizations.findOneEntity).not.toHaveBeenCalled();
  });
});
