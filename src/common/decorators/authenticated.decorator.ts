import { SetMetadata } from '@nestjs/common';

export const AUTHENTICATED_KEY = 'authenticated';

/**
 * The explicit authorization rule for a STAFF route that is deliberately open to every signed-in staff
 * session regardless of role — the caller's own profile/preferences/sessions, shared read-only reference
 * data (LOV lists, system attributes), the dashboard. Staff authorization is deny-by-default
 * (PermissionGuard): a route with none of @Public, @Permission, @Roles or this marker is refused, so a
 * newly added endpoint is closed until someone consciously chooses its rule.
 *
 * It never lets a customer session in — a customer needs @CustomerAccessible, which CustomerAccessGuard
 * checks first — and it grants nothing to anyone who is not signed in. Where the handler enforces a
 * finer rule itself (for example AttributeService.update checking EDIT_ATTRIBUTE) say so next to the
 * decorator, so the route's real rule is discoverable.
 */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);
