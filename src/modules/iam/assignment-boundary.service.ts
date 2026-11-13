import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Actor, isSuperAdminActor } from '../../common/security/actor';
import { ACTOR_KIND } from '../../common/constants/auth.constants';
import { UserRole } from '../user-role/entities/user-role.entity';
import { IamService } from './iam.service';

/** How many permission codes a refusal names — enough to act on, never a wall of text. */
const MAX_NAMED_CODES = 5;

/** The 403 message when roles are beyond the actor's scope. `offending` lists each refused role with the codes it grants that the actor does not hold. */
export function assignmentBoundaryMessage(offending: ReadonlyArray<{ roleName: string; codes: readonly string[] }>): string {
  const [first, ...others] = offending;
  const named = first.codes.slice(0, MAX_NAMED_CODES).join(', ');
  const more = first.codes.length > MAX_NAMED_CODES ? ` and ${first.codes.length - MAX_NAMED_CODES} more` : '';
  const alsoRefused = others.length > 0 ? ` ${others.length} other role${others.length === 1 ? '' : 's'} in this request ${others.length === 1 ? 'is' : 'are'} also beyond your scope.` : '';
  return (
    `Cannot assign the role "${first.roleName}": it grants permissions you do not hold (${named}${more}). ` +
    `A delegated administrator can only hand out permissions it holds itself.${alsoRefused}`
  );
}

/** The 403 message when an ACCOUNT is beyond the actor's scope. `action` completes "Cannot …" ("reset the password of"). Unlike the role message
 *  it names no permission: what another account holds is not something an error should read out to a delegated administrator. */
export function accountBoundaryMessage(action: string): string {
  return (
    `Cannot ${action} this account: it holds permissions you do not hold. ` +
    'A delegated administrator can only take over an account whose permissions it holds itself.'
  );
}

/**
 * The ASSIGNMENT BOUNDARY — what stops a delegated administrator from granting more than it has.
 *
 * Handing a role to a user hands out everything that role grants. CREATE_USER / EDIT_USER are delegable permissions, so
 * without a boundary an administrator whose policies grant only user management could give any account any ordinary role — including a
 * role with far broader business permissions than its own — and so grant itself (through a second account) or anyone else more than it
 * was ever given. The boundary closes that: an actor may assign a role only if EVERY permission the role grants is one the actor itself
 * holds right now. A role that grants nothing is always assignable.
 *
 * Taking over an account is the same grant by another route: RESET_USER_PASSWORD is delegable too, and a reset hands the actor a working
 * login for the account — so the account is held to the same rule (assertAccountWithinBoundary): a delegated administrator may take over
 * an account only if every permission the account holds is one the administrator holds itself.
 *
 * The one unbounded actor is the installation's super administrator (and the boot-time system): the role itself, and the right to grant
 * it, are protected by their own rules (UserRoleService), and a super administrator holds every permission anyway. Policy authoring
 * (policies, inline policies, the resource catalogue, role-permission trees) is not delegable at all — those routes are
 * `@Roles(SUPER_ADMIN)` — so assigning roles and taking over accounts are the only paths by which a delegated administrator could ever
 * widen its own or anyone's access.
 *
 * "Holds" is computed exactly like authorization is: the union of the Allow codes of the policies and inline policies of every role the
 * account currently holds, plus the account's own inline policies — read live on every call, never from a token and never cached
 * (IamService.getActionCodesGrantedByPoliciesForRoles). When the caller passes its open transaction (UserRoleService.addRolesToUser does),
 * EVERY read — the user_roles rows, the policies, the inline policies — runs on that transaction's one connection, so the check and the
 * grant see the same rows and the transaction never waits for a second pool connection while it holds the first.
 *
 * What it does not do, on purpose: it compares Allow codes only (no Deny exists); it is checked WHEN a role is handed out, not
 * re-evaluated later (an administrator who afterwards loses a permission, or a role a super administrator widens afterwards, leaves the
 * earlier assignments as they are); and it is not a wall between peers — two delegated administrators can still pass each other roles that are
 * within what the giver holds.
 */
@Injectable()
export class AssignmentBoundaryService {
  constructor(
    private readonly iam: IamService,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
  ) {}

  /** The action codes the ACCOUNT `userId` holds right now: the policies and inline policies of every role it currently holds, plus its own inline policies. */
  async codesHeldByUser(userId: number, manager?: EntityManager): Promise<Set<string>> {
    const repo = manager ? manager.getRepository(UserRole) : this.userRoles;
    const rows = await repo.find({ where: { userId } });
    return this.iam.getActionCodesGrantedByPoliciesForRoles(
      rows.map((row) => row.roleId),
      userId,
      manager,
    );
  }

  /** The action codes `actor` holds right now. Empty for the system actor (which is unbounded and never asked). */
  async codesHeldBy(actor: Actor, manager?: EntityManager): Promise<Set<string>> {
    if (actor.kind !== ACTOR_KIND.USER) return new Set();
    return this.codesHeldByUser(actor.id, manager);
  }

  /** For each role id: the codes it grants that `held` does not contain — an empty list means the role is within scope. */
  async excessOf(roleIds: readonly number[], held: ReadonlySet<string>, manager?: EntityManager): Promise<Map<number, string[]>> {
    const byRole = await this.iam.getActionCodesByRole([...roleIds], manager);
    const excess = new Map<number, string[]>();
    for (const roleId of roleIds) excess.set(roleId, [...(byRole.get(roleId) ?? [])].filter((code) => !held.has(code)).sort());
    return excess;
  }

  /**
   * Refuses (403) the assignment of any of `roles` that grants a permission `actor` does not hold. Nothing is assigned: the caller
   * throws before it writes. A super administrator and the system pass without a lookup.
   */
  async assertWithinBoundary(actor: Actor, roles: ReadonlyArray<{ id: number; roleName: string }>, manager?: EntityManager): Promise<void> {
    if (isSuperAdminActor(actor) || roles.length === 0) return;
    const held = await this.codesHeldBy(actor, manager);
    const excess = await this.excessOf(
      roles.map((role) => role.id),
      held,
      manager,
    );
    const offending = roles.filter((role) => (excess.get(role.id) ?? []).length > 0).map((role) => ({ roleName: role.roleName, codes: excess.get(role.id) ?? [] }));
    if (offending.length > 0) throw new ForbiddenException(assignmentBoundaryMessage(offending));
  }

  /**
   * Refuses (403) taking over the account `targetUserId` — resetting its credentials — when it holds any permission `actor` does not hold.
   * A super administrator and the system pass without a lookup, and nobody is ever "beyond" their own account. The refusal names no permission
   * (accountBoundaryMessage).
   */
  async assertAccountWithinBoundary(actor: Actor, targetUserId: number, action: string, manager?: EntityManager): Promise<void> {
    if (isSuperAdminActor(actor)) return;
    if (actor.kind === ACTOR_KIND.USER && actor.id === targetUserId) return;
    const held = await this.codesHeldBy(actor, manager);
    const target = await this.codesHeldByUser(targetUserId, manager);
    for (const code of target) {
      if (!held.has(code)) throw new ForbiddenException(accountBoundaryMessage(action));
    }
  }
}
