import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PENDING_PASSWORD_CHANGE_KEY } from '../decorators/allow-pending-password-change.decorator';
import { AuthPrincipal } from '../../auth/interfaces/authenticated-user.interface';
import { PRINCIPAL_TYPE } from '../constants/auth.constants';

/** Machine-readable code of the 403 this guard raises; the web app keys its redirect to the
 *  force-password-change screen on it. */
export const PASSWORD_CHANGE_REQUIRED_CODE = 'PASSWORD_CHANGE_REQUIRED';

/**
 * Enforces `mustChangePassword` on the server. A staff user whose password is flagged for change (new
 * account, or an admin reset that asked for it) may reach only the routes marked
 * @AllowPendingPasswordChange — change the password, sign out, read their own session context — and gets
 * a 403 PASSWORD_CHANGE_REQUIRED everywhere else. Before this guard the flag only told the web app to
 * show a screen; any API client could ignore it.
 *
 * The flag is read live by JwtStrategy on every request (never from the token), so it takes effect
 * immediately when an admin sets it and clears the moment the password is changed. Customers have no
 * such flag; public routes have no principal.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>().user;
    if (!user || user.type === PRINCIPAL_TYPE.CUSTOMER || !user.mustChangePassword) {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return true;
    }

    throw new ForbiddenException({
      code: PASSWORD_CHANGE_REQUIRED_CODE,
      message: 'You must change your password before you can continue.',
    });
  }
}
