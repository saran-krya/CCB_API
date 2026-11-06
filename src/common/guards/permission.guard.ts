import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/permission.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AUTHENTICATED_KEY } from '../decorators/authenticated.decorator';
import { ALLOW_PENDING_PASSWORD_CHANGE_KEY } from '../decorators/allow-pending-password-change.decorator';
import { STAFF_PERMISSION_KEY } from '../decorators/staff-permission.decorator';
import { AuthenticatedUser, AuthPrincipal } from '../../auth/interfaces/authenticated-user.interface';
import { RolePermissionsService } from '../../modules/role-permissions/role-permissions.service';
import { PRINCIPAL_TYPE } from '../constants/auth.constants';

/**
 * The last guard in the chain (JwtAuthGuard -> CustomerAccessGuard -> PasswordChangeGuard -> RolesGuard
 * -> this) and the one that makes STAFF authorization DENY-BY-DEFAULT. A staff request is allowed only
 * when the route carries an explicit rule it satisfies:
 *   - `@Permission(...)` — ANY live role (or the user's own inline policy) must grant ANY listed code;
 *   - `@StaffPermission(...)` — the same any-of check, for a self-service route a customer session shares with staff;
 *   - `@Roles(...)`      — RolesGuard already enforced it earlier in the chain;
 *   - `@Authenticated()` — deliberately open to every signed-in staff session.
 * A route with none of these (a forgotten decorator on a new endpoint) is refused and logged, instead of
 * being open to any signed-in user as it used to be. `@Public()` routes are never reached with a user.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rolePermissions: RolePermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    const user = request.user;

    // JwtAuthGuard authenticates every non-public route, so a missing principal here is never expected
    // — and is never allowed.
    if (!user) {
      return false;
    }

    const requiredActionCodes = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, targets);
    const hasPermissionRule = !!requiredActionCodes?.length;

    // A customer session has no Role/RolePermission row at all, so it can never satisfy an RBAC action
    // code; every @Permission route is staff-only. Which non-@Permission routes a customer may call is
    // decided earlier by CustomerAccessGuard (@CustomerAccessible), so reaching this point on one means
    // that guard has already allowed it.
    if (user.type === PRINCIPAL_TYPE.CUSTOMER) {
      return !hasPermissionRule;
    }

    if (hasPermissionRule) {
      return this.holdsAnyAction(user, requiredActionCodes!);
    }

    // A self-service route shared with the customer portal: a staff session must hold one of the codes (a customer was
    // already let through above, as it is on any route without @Permission). The one exception is a user who must change
    // their password and calls a route that is allowed while that is pending — see StaffPermission.
    const staffActionCodes = this.reflector.getAllAndOverride<string[]>(STAFF_PERMISSION_KEY, targets);
    if (staffActionCodes?.length) {
      if (
        user.mustChangePassword &&
        this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE_KEY, targets)
      ) {
        return true;
      }
      return this.holdsAnyAction(user, staffActionCodes);
    }

    // No @Permission: the route's rule is @Roles (already enforced by RolesGuard) or @Authenticated().
    if (
      this.reflector.getAllAndOverride<string[]>(ROLES_KEY, targets)?.length ||
      this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets)
    ) {
      return true;
    }

    this.logger.warn(
      `Denied ${context.getClass().name}.${context.getHandler().name}: the route has no authorization rule ` +
        '(add @Permission, @Roles, @Authenticated or @Public).',
    );
    return false;
  }

  /** Whether the staff user holds ANY of `actionCodes`. The user's LIVE roles decide — JwtStrategy re-reads user_roles on
   *  every request and attaches them as `roleIds`, so a role revoked since the token was issued no longer counts and a
   *  secondary role counts as much as the primary. Allowed iff ANY live role grants ANY code (additive union, see
   *  IamService.getActionCodesGrantedByPoliciesForRoles), resolved ONCE for the whole set of codes. `?? [roleId]` only
   *  covers a principal built without `roleIds` (the live primary); an EMPTY `roleIds` is never replaced by it — `??`
   *  substitutes only null/undefined — and denies. `user.sub` adds the user's OWN inline policies to the same union,
   *  resolved live, so deleting an inline policy stops granting access on the next request. */
  private async holdsAnyAction(user: AuthenticatedUser, actionCodes: string[]): Promise<boolean> {
    const roleIds = user.roleIds ?? [user.roleId];
    if (roleIds.length === 0) {
      return false;
    }
    return this.rolePermissions.rolesHaveAnyAction(roleIds, actionCodes, user.sub);
  }
}
