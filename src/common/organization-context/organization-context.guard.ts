import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../../auth/interfaces/authenticated-user.interface';
import { OrganizationContextService } from './organization-context.service';

/**
 * Populates the request's OrganizationContextService from the already-live-resolved authenticated
 * principal (JwtStrategy.validate has already run by the time any guard sees the request — this is
 * the FIRST guard after JwtAuthGuard in the chain, see AuthModule's provider order) — never a second
 * lookup, never anything the client supplied. Always returns `true`: this guard only ever populates
 * context, it never makes an authorization decision (that's RolesGuard/PermissionGuard/
 * CustomerAccessGuard's job) — an unauthenticated `@Public()` request simply gets `null` context,
 * same as a SUPER_ADMIN's own platform-level request.
 */
@Injectable()
export class OrganizationContextGuard implements CanActivate {
  constructor(private readonly context: OrganizationContextService) {}

  canActivate(executionContext: ExecutionContext): boolean {
    const request = executionContext.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    this.context.setOrganizationId(request.user?.organizationId ?? null);
    return true;
  }
}
