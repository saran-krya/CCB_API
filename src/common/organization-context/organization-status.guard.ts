import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_SUSPENDED_ORG_KEY } from '../decorators/allow-suspended-org.decorator';
import { ERROR_MESSAGES } from '../constants/error-messages.constants';
import { OrganizationContextService } from './organization-context.service';
import { OrganizationService } from '../../modules/organization/organization.service';
import { OrganizationStatus } from '../../modules/organization/entities/organization.entity';

/**
 * Blocks a tenant session from reaching normal application routes while its Organization is
 * SUSPENDED, INACTIVE or still PENDING — data is never deleted or altered by this (see
 * OrganizationService's status-transition rules), only access. Runs immediately after
 * CustomerAccessGuard (see AuthModule's provider order), so a suspended organization's Customer AND
 * staff sessions are blocked the same way.
 *
 * A `null` organization context (the platform SUPER_ADMIN, or an unauthenticated `@Public()` route)
 * always passes — there is no organization to check status for. SUPER_ADMIN's own platform-level
 * requests are never subject to THIS guard's check at all (it only ever evaluates the ACTING
 * session's own organization, never a target organization it might be inspecting under Support
 * Access — that is a separate, explicitly-audited mechanism, not a bypass of this guard).
 */
@Injectable()
export class OrganizationStatusGuard implements CanActivate {
  constructor(
    private readonly context: OrganizationContextService,
    private readonly organizations: OrganizationService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const organizationId = this.context.getOrganizationId();
    if (organizationId === null) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (isPublic) return true;

    const organization = await this.organizations.findOneEntity(organizationId);
    if (organization.status === OrganizationStatus.ACTIVE) return true;

    const allowWhileSuspended = this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED_ORG_KEY, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (allowWhileSuspended) return true;

    throw new ForbiddenException(ERROR_MESSAGES.ORGANIZATION_NOT_ACTIVE);
  }
}
