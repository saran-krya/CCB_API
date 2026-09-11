/**
 * The JWT payload shape for BOTH session kinds this app issues — internal staff (User) and
 * customer-portal (Customer). `type` is the discriminant every guard/strategy branches on:
 *   - 'staff' (the default/original shape, unchanged): `sub` is a User id, `roleId`/`roleName` are
 *     always present and drive RolesGuard/PermissionGuard.
 *   - 'customer': `sub` is a Customer id. `roleId`/`roleName` are deliberately ABSENT (a Customer
 *     has no Role row) — RolesGuard/PermissionGuard already fail closed/no-op correctly for this
 *     (see their own doc comments), since no current route carries @Roles/@Permission metadata
 *     intended for a customer session. Every existing @CurrentUser() consumer that only reads
 *     `.sub`/`.email` for an actorId (17 controllers, none of which are customer-facing) is
 *     unaffected — this field is additive, and `roleId`/`roleName` remain required on the type so
 *     none of those call sites need to narrow on `type` just to keep compiling.
 */
export interface AuthenticatedUser {
  sub: number;
  email: string;
  roleId: number;
  roleName: string;
  type?: 'staff';
}

export interface AuthenticatedCustomer {
  sub: number;
  email: string;
  type: 'customer';
}

export type AuthPrincipal = AuthenticatedUser | AuthenticatedCustomer;
