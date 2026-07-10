import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/permission.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { RolePermissionsService } from '../../modules/role-permissions/role-permissions.service';

// Business-module counterpart to RolesGuard — gates routes carrying
// @Permission(...) against the same RolePermission rows the frontend's
// usePermission() hook already reads (via getUserPermissions). No role
// bypass of any kind — Role → Permissions is the single source of truth
// for every role, including SUPER_ADMIN/ADMIN, whose day-to-day access
// comes from real granted rows (seeded for every action except the
// approve/reject exclusions), not a hardcoded role check.
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

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
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
