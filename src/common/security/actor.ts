import { ROLES } from '../constants/global';
import { AuthPrincipal } from '../../auth/interfaces/authenticated-user.interface';
import { PRINCIPAL_TYPE, ACTOR_KIND } from '../constants/auth.constants';

/**
 * Who is performing a privileged write — the identity the protection rules (who may grant SUPER_ADMIN,
 * touch a SUPER_ADMIN account, ...) are decided against. It is built from the request principal, whose
 * `roleNames` JwtStrategy re-reads from user_roles on every request, so it is the user's CURRENT roles —
 * never a role claim from a token.
 *
 * `system` is the boot-time seed/migration path (no signed-in user); only code that runs without a
 * request may pass it, never a controller.
 */
export type Actor = { kind: 'user'; id: number; roleNames: string[] } | { kind: 'system' };

export const SYSTEM_ACTOR: Actor = { kind: ACTOR_KIND.SYSTEM };

/** The Actor for an authenticated STAFF principal. Throws on a missing or customer principal, so a
 *  privileged service call can never be made on behalf of "nobody". */
export function actorFrom(principal: AuthPrincipal | undefined): Actor {
  if (!principal || principal.type === PRINCIPAL_TYPE.CUSTOMER) {
    throw new Error('A signed-in staff user is required for this operation.');
  }
  return { kind: ACTOR_KIND.USER, id: principal.sub, roleNames: principal.roleNames ?? [principal.roleName] };
}

export const isSuperAdminActor = (actor: Actor): boolean =>
  actor.kind === ACTOR_KIND.SYSTEM || actor.roleNames.includes(ROLES.SUPER_ADMIN);

/** The user id behind the actor (for audit `performedBy`), undefined for the system. */
export const actorUserId = (actor: Actor): number | undefined => (actor.kind === ACTOR_KIND.USER ? actor.id : undefined);

export const SUPER_ADMIN_ASSIGN_MESSAGE = 'Only SUPER_ADMIN can assign the SUPER_ADMIN role.';
export const SUPER_ADMIN_MODIFY_MESSAGE = 'Only SUPER_ADMIN can modify a SUPER_ADMIN account.';
