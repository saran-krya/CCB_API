import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/permission.decorator';
import { AuthPrincipal } from '../../auth/interfaces/authenticated-user.interface';
import { RolePermissionsService } from '../../modules/role-permissions/role-permissions.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rolePermissions: RolePermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredActionCodes = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredActionCodes?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    const user = request.user;

    // A customer session has no Role/RolePermission row at all — every @Permission-guarded route
    // today is staff-only (RBAC action codes like VIEW_CUSTOMER, CREATE_REGISTRATION_REQUEST are
    // all staff actions), so a customer token can never legitimately satisfy one. Denying here
    // (rather than calling rolesHaveAction with an undefined roleId) is deliberate and explicit, not
    // an accident of missing data.
    if (!user || user.type === 'customer') {
      return false;
    }

    // The user's LIVE roles decide — JwtStrategy re-reads user_roles on every request and attaches
    // them as `roleIds`, so a role revoked since the token was issued no longer counts and a
    // secondary role counts as much as the primary. Allowed iff ANY live role grants ANY required
    // code (additive union, see IamService.getActionCodesGrantedByPoliciesForRoles). `?? [roleId]`
    // only covers a principal built without `roleIds` (the live primary); an EMPTY `roleIds` is
    // never replaced by it — `??` substitutes only null/undefined — and denies.
    const roleIds = user.roleIds ?? [user.roleId];
    if (roleIds.length === 0) {
      return false;
    }

    // `user.sub` adds the user's OWN inline policies to the same union — resolved live, so deleting
    // an inline policy stops granting access on the next request.
    for (const actionCode of requiredActionCodes) {
      if (await this.rolePermissions.rolesHaveAction(roleIds, actionCode, user.sub)) {
        return true;
      }
    }

    return false;
  }
}
