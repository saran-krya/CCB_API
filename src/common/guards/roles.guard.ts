import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthPrincipal } from '../../auth/interfaces/authenticated-user.interface';
import { isAdministratorRoleName } from '../security/administrator-roles';
import { PRINCIPAL_TYPE } from '../constants/auth.constants';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    const user = request.user;

    // A customer session carries no roleName at all — every @Roles-guarded route today is
    // staff-only, so a customer token can never satisfy one.
    if (!user || user.type === PRINCIPAL_TYPE.CUSTOMER) {
      return false;
    }

    // The user's LIVE role names decide (JwtStrategy re-reads user_roles on every request) — never a
    // role claim from the JWT — so SUPER_ADMIN held as a SECONDARY role still bypasses, and a
    // SUPER_ADMIN claim in a token issued before the role was revoked grants nothing. `?? [roleName]`
    // only covers a principal built without `roleNames` (the live primary).
    const roleNames = user.roleNames ?? [user.roleName];

    // The installation's super administrator (SUPER_ADMIN — see
    // common/security/administrator-roles.ts) passes every @Roles check: every @Roles route is an administration route of THIS
    // installation. A delegated administrator ("ADMIN") is not in the family: it passes only the routes that name its role, and
    // otherwise has exactly the permissions its Policies grant.
    if (roleNames.some(isAdministratorRoleName)) {
      return true;
    }

    return roleNames.some((roleName) => requiredRoles.includes(roleName));
  }
}
