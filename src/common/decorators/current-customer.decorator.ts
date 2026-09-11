import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthPrincipal, AuthenticatedCustomer } from '../../auth/interfaces/authenticated-user.interface';

/**
 * The Customer-portal counterpart to `@CurrentUser()` — asserts the authenticated principal is a
 * Customer session and returns it narrowed to `AuthenticatedCustomer` (`sub` = Customer.id), so a
 * handler never has to re-check `principal.type` itself. Only usable on routes CustomerAccessGuard
 * has already confirmed are `@CustomerAccessible()` (or a staff route a Customer could never reach
 * in the first place); the throw below is a defensive backstop, not the primary security boundary
 * — CustomerAccessGuard is.
 */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedCustomer => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    const user = request.user;
    if (!user || user.type !== 'customer') {
      throw new UnauthorizedException('Customer session required');
    }
    return user;
  },
);
