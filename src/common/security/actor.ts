import { AuthPrincipal } from '../../auth/interfaces/authenticated-user.interface';
import { PRINCIPAL_TYPE, ACTOR_KIND } from '../constants/auth.constants';
import { isAdministratorRoleName } from './administrator-roles';

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

/**
 * Whether the actor is a super administrator of this installation (a holder of SUPER_ADMIN) or the boot-time system. This is THE
 * privilege test for everything that hands out, edits or takes over the administrator role or an administrator's account. Every other
 * actor — a delegated administrator ("ADMIN") with however much CREATE_USER / EDIT_USER / RESET_USER_PASSWORD / EDIT_ROLE it holds — is NOT
 * one: those permissions are delegable and must never be a path to minting a super administrator or taking over one.
 */
export const isSuperAdminActor = (actor: Actor): boolean =>
  actor.kind === ACTOR_KIND.SYSTEM || actor.roleNames.some(isAdministratorRoleName);

/** The user id behind the actor (for audit `performedBy`), undefined for the system. */
export const actorUserId = (actor: Actor): number | undefined => (actor.kind === ACTOR_KIND.USER ? actor.id : undefined);

export const SUPER_ADMIN_ASSIGN_MESSAGE = 'Only SUPER_ADMIN can assign the SUPER_ADMIN role.';
export const SUPER_ADMIN_MODIFY_MESSAGE = 'Only SUPER_ADMIN can modify a SUPER_ADMIN account.';

/** The 403 when an action would delete, deactivate, demote or lock out the installation's INITIAL SUPER_ADMIN (the oldest active holder —
 *  UserRoleService.initialAdministratorId). `action` completes "Cannot …" ("delete", "deactivate", "demote", "disable the sign-in access of"). */
export const initialSuperAdminProtectedMessage = (action: string): string =>
  `Cannot ${action} the initial SUPER_ADMIN account — it is protected so that an installation can never lose its owner by accident. ` +
  'To hand it over, use the server maintenance tool (docs/ON_PREMISE_SUPER_ADMIN.md).';
