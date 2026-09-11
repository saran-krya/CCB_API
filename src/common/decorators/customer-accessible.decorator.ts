import { SetMetadata } from '@nestjs/common';

export const CUSTOMER_ACCESSIBLE_KEY = 'customerAccessible';

export interface CustomerAccessibleOptions {
  /**
   * Allow this route even for a Customer whose registration/deposit sub-process isn't resolved yet
   * (see `isDepositResolved` — RegistrationRequest.depositStatus not yet Verified/Not Required).
   * Default `false`: a route needs this explicitly opted in to be reachable by a deposit-restricted
   * Customer — the safe/fail-closed default is "requires full activation", so a newly-added
   * Customer-Portal endpoint is automatically off-limits to a restricted Customer without anyone
   * having to remember to lock it down. Only the handful of routes a restricted Customer genuinely
   * needs to finish registration (their own security deposit GET/POST, their own registration
   * request GET, profile GET, and the shared self-service auth routes) should set this `true` — see
   * CustomerAccessGuard's own doc comment for the full reasoning and CustomerPortalController for
   * which routes actually opt in.
   */
  allowRestricted?: boolean;
}

/**
 * Marks a route as callable by an authenticated Customer session (`type: 'customer'`), the
 * customer-portal counterpart to `@Permission(...)` for staff. Deliberately takes no action codes
 * — there is no Role/Permission tree for Customers (see CustomerAccessGuard's own doc comment for
 * why that's a deliberate design choice, not a gap) — this is a plain marker, same shape as
 * `@Public()`, now carrying exactly one extra bit of metadata (`allowRestricted`) for the
 * registration/deposit-lifecycle gate. The handler itself is still responsible for scoping the
 * response to the authenticated customer's own resources (see `@CurrentCustomer()` and
 * `CustomerService.getOwnedUnitIds`), the same way a `@Permission`-guarded staff handler is
 * responsible for its own query logic once RBAC has cleared it — this decorator only answers "may a
 * customer call this endpoint at all (and in which lifecycle state)", never "which rows may they
 * see".
 *
 * A route with NEITHER `@Public()` nor `@CustomerAccessible()` nor `@Permission(...)`/`@Roles(...)`
 * is staff-only by default — CustomerAccessGuard denies any customer session that reaches it.
 */
export const CustomerAccessible = (options: CustomerAccessibleOptions = {}) =>
  SetMetadata(CUSTOMER_ACCESSIBLE_KEY, { allowRestricted: options.allowRestricted ?? false });
