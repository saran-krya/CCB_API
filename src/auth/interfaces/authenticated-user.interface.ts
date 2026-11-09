/**
 * The JWT payload shape for BOTH session kinds this app issues — internal staff (User) and
 * customer-portal (Customer). `type` is the discriminant every guard/strategy branches on:
 *   - 'staff' (the default/original shape, unchanged): `sub` is a User id. `roleId`/`roleName` are
 *     always present: in a SIGNED token they are the user's primary role at issue time, kept for
 *     compatibility only and never trusted; on a REQUEST principal (what JwtStrategy.validate
 *     returns) they are the live primary role, and the live role SET in `roleIds`/`roleNames` is
 *     what drives RolesGuard/PermissionGuard.
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
  /** The user's LIVE roles — every current user_roles row, in assignment order (user_roles.id ASC),
   *  so index 0 is the primary role. Resolved by JwtStrategy.validate on EVERY request and never
   *  signed into a token (AuthService.issueTokenPair's payloads don't carry them), which is what
   *  makes a role revoked or granted after the token was issued take effect on the very next
   *  request made with that same token. Authorization decisions must use these (see RolesGuard,
   *  PermissionGuard, `GET /auth/me/actions`), never a role claim read from the JWT: the singular
   *  `roleId`/`roleName` above only describe the first of possibly several roles, so deciding from
   *  them would under-authorize a multi-role user. Optional only because the same type also
   *  describes the signed payload, which never carries them. */
  roleIds?: number[];
  roleNames?: string[];
  /** Whether this user must change their password before doing anything else. Resolved live from the
   *  user row on every request by JwtStrategy (never signed into a token), and enforced by
   *  PasswordChangeGuard. */
  mustChangePassword?: boolean;
  /** The session this token belongs to — see AuthenticatedCustomer.sid (identical for both session kinds). */
  sid?: string;
  type?: 'staff';
  /** The user's LIVE organization — `null` for the one platform SUPER_ADMIN user, a real id for every
   *  tenant-scoped staff user. Resolved by JwtStrategy.validate from the live User row on every
   *  request (UserService.findAuthState), exactly like roleIds/roleNames — never signed into the JWT
   *  as a trusted claim, never accepted from a frontend header/query/body. Optional only because the
   *  same type also describes the signed payload, which never carries it. */
  organizationId?: number | null;
}

export interface AuthenticatedCustomer {
  sub: number;
  email: string;
  type: 'customer';
  /** The Customer's own organization (their Unit/Property/Community's organization, denormalized onto
   *  the Customer row) — resolved live by JwtStrategy.validate from CustomerService.findAuthState,
   *  same non-negotiable posture as AuthenticatedUser.organizationId above. */
  organizationId?: number | null;
  /** The session this token belongs to: the refresh-token family, a server-generated UUID created at sign-in and kept
   *  across refresh rotations. AuthService.issueTokenPair signs it into every access token, and JwtStrategy refuses the
   *  token as soon as that session has no live refresh token (signed out, revoked, replaced after a password change,
   *  expired) — so "this session" in Active Sessions and "sign out the others" come from here, never from a client
   *  header. Absent only on a token issued before this claim existed; that token stays valid until it expires. */
  sid?: string;
}

export type AuthPrincipal = AuthenticatedUser | AuthenticatedCustomer;
