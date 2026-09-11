import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CUSTOMER_ACCESSIBLE_KEY, CustomerAccessibleOptions } from '../decorators/customer-accessible.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthPrincipal } from '../../auth/interfaces/authenticated-user.interface';
import { RegistrationRequestService } from '../../modules/registration-request/registration-request.service';
import { computePortalAccess } from '../../modules/registration-request/entities/registration-request.entity';

/**
 * The Customer-portal counterpart to RolesGuard/PermissionGuard — same global-guard shape, same
 * "deny by default" posture, but deliberately NOT a second RBAC system: a Customer has no
 * Role/Module/SubModule/Action tree at all (see Customer.entity's own doc comments — that's a
 * business-model choice, not a gap to fill), so there is nothing to look up here. This guard answers
 * TWO questions for a Customer session — "may THIS session call THIS route at all" (as before), and
 * now also "is this Customer's registration/deposit sub-process resolved enough for THIS route" (the
 * new registration-completion gate) — never "which rows may they see", which stays the handler's own
 * job via CurrentCustomer + CustomerService.getOwnedUnitIds (ownership/resource-scope checks),
 * exactly mirroring how PermissionGuard clears a staff route and the service/controller still does
 * its own query filtering.
 *
 * Runs immediately after JwtAuthGuard, before RolesGuard/PermissionGuard (see AuthModule's provider
 * order) — for a STAFF session this guard always no-ops (`true`), leaving RolesGuard/PermissionGuard
 * as the real staff authorization boundary, completely unchanged. For a CUSTOMER session, this guard
 * IS the boundary:
 *
 * 1. The route must carry `@CustomerAccessible()` (or `@Public()`, e.g. activate) or the request is
 *    denied — a route with neither is staff-only by default, so a newly-added staff endpoint is
 *    automatically safe for customers without anyone having to remember to guard it.
 * 2. If the Customer's own registration/deposit sub-process is NOT yet resolved (per
 *    computePortalAccess — Not Required, or Verified together with accountStatus already ACTIVE, are
 *    the only two "full" outcomes), the route ALSO needs
 *    `@CustomerAccessible({ allowRestricted: true })` — otherwise a Customer who has completed
 *    account setup but not yet had a required Security Deposit verified gets denied the normal
 *    Customer Portal, restricted to only the handful of routes that opt in (their own security
 *    deposit + registration-request reads, profile, self-service auth). This is resolved with a
 *    LIVE read of the Customer's own registration request every time (RegistrationRequestService.
 *    getMyDepositStatus), never trusted from the JWT (which carries no lifecycle fields at all — see
 *    AuthPrincipal's own doc comment) or from any client-supplied value — the backend stays the
 *    final authorization boundary exactly as required.
 *
 * A Customer with no registration request on file at all (should not happen in practice — Customer
 * rows are only ever created via RegistrationRequestService.approve()) is treated as unresolved —
 * fail closed, never fail open — so `allowRestricted` routes are the only ones such a session could
 * ever reach.
 */
@Injectable()
export class CustomerAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly registrationRequests: RegistrationRequestService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    const user = request.user;

    if (!user || user.type !== 'customer') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const options = this.reflector.getAllAndOverride<CustomerAccessibleOptions | undefined>(CUSTOMER_ACCESSIBLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) {
      return false;
    }

    if (options.allowRestricted) {
      return true;
    }

    const { depositStatus, accountStatus } = await this.registrationRequests.getMyDepositStatus(user.sub);
    return computePortalAccess(depositStatus, accountStatus) === 'full';
  }
}
