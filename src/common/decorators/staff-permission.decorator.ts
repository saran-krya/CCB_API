import { SetMetadata } from '@nestjs/common';

export const STAFF_PERMISSION_KEY = 'staffPermission';

/**
 * The permission rule for a self-service route that a CUSTOMER session shares with staff (devices, login history, change
 * password). A staff session must hold ANY of the listed action codes (the same Policy-based resolution as `@Permission`:
 * live roles plus the user's own inline policies); a customer session is not asked for one — it has no Role or Policy, and
 * CustomerAccessGuard already decided whether it may call the route at all.
 *
 * `@Permission` cannot do this job: it refuses every customer. Use it on staff-only routes, and this decorator only where
 * the same URL also serves the customer portal. Pair it with `@Authenticated()` so the route still carries a rule for
 * customer sessions.
 *
 * A staff user who MUST change their password (`mustChangePassword`) is let through on a route that is also marked
 * `@AllowPendingPasswordChange` — otherwise a brand-new account without the change-password grant could never complete the
 * forced first-login change and would be locked out.
 */
export const StaffPermission = (...actionCodes: string[]) => SetMetadata(STAFF_PERMISSION_KEY, actionCodes);
