import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthPrincipal } from '../../auth/interfaces/authenticated-user.interface';
import { ROLES } from '../constants/global';

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
    if (!user || user.type === 'customer') {
      return false;
    }

    // The user's LIVE role names decide (JwtStrategy re-reads user_roles on every request) — never a
    // role claim from the JWT — so SUPER_ADMIN held as a SECONDARY role still bypasses, and a
    // SUPER_ADMIN claim in a token issued before the role was revoked grants nothing. `?? [roleName]`
    // only covers a principal built without `roleNames` (the live primary).
    const roleNames = user.roleNames ?? [user.roleName];

    if (roleNames.includes(ROLES.SUPER_ADMIN)) {
      return true;
    }

    return roleNames.some((roleName) => requiredRoles.includes(roleName));
  }
}
