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
    // (rather than calling roleHasAction with an undefined roleId) is deliberate and explicit, not
    // an accident of missing data.
    if (!user || user.type === 'customer') {
      return false;
    }

    for (const actionCode of requiredActionCodes) {
      if (await this.rolePermissions.roleHasAction(user.roleId, actionCode)) {
        return true;
      }
    }

    return false;
  }
}
