import { ForbiddenException } from '@nestjs/common';
import { AssignmentBoundaryService, accountBoundaryMessage, assignmentBoundaryMessage } from './assignment-boundary.service';
import { UserRole } from '../user-role/entities/user-role.entity';
import { Actor, SYSTEM_ACTOR } from '../../common/security/actor';

// The ASSIGNMENT BOUNDARY: a delegated administrator ("ADMIN") may hand a role to a user only if EVERY permission that role grants is one the
// administrator itself holds right now — otherwise CREATE_USER / EDIT_USER would be a way to give anyone more than the administrator was ever
// given. Taking over an ACCOUNT (resetting its password) is the same grant by another route, so the account is held to the same rule.
// "Holds" is IamService's live union (policies + inline policies of the account's CURRENT roles, plus the account's own inline policies); the
// per-role grants come from IamService.getActionCodesByRole. The installation's SUPER_ADMIN and the boot-time system are unbounded. Isolated
// tests: IamService and the repositories are plain mocks — the rules under test are the comparison, the live lookups and who is exempt.

const user = (id: number, ...roleNames: string[]): Actor => ({ kind: 'user', id, roleNames });
const ACTOR_ID = 7;
const DELEGATED = user(ACTOR_ID, 'USER_MANAGER');
const SUPER_ADMIN = user(1, 'SUPER_ADMIN');

interface Setup {
  /** The permission codes the actor (user 7) holds — what IamService.getActionCodesGrantedByPoliciesForRoles resolves for it. */
  held?: string[];
  /** The role ids on the actor's own user_roles rows. */
  actorRoleIds?: number[];
  /** What each role grants, by role id. A role absent from here grants nothing (it has no Allow statement at all). */
  roleCodes?: Record<number, string[]>;
  /** The permission codes OTHER accounts hold, by user id (an id not listed here resolves like the actor). */
  heldByUser?: Record<number, string[]>;
  /** The role ids on OTHER accounts' user_roles rows, by user id. */
  roleIdsByUser?: Record<number, number[]>;
}

function build({ held = [], actorRoleIds = [10], roleCodes = {}, heldByUser = {}, roleIdsByUser = {} }: Setup = {}) {
  const iam = {
    getActionCodesGrantedByPoliciesForRoles: jest.fn(async (_roleIds: number[], userId?: number) =>
      new Set(userId !== undefined && heldByUser[userId] ? heldByUser[userId] : held),
    ),
    getActionCodesByRole: jest.fn(async (roleIds: number[]) => {
      const byRole = new Map<number, Set<string>>();
      for (const id of roleIds) if (roleCodes[id]) byRole.set(id, new Set(roleCodes[id]));
      return byRole;
    }),
  };
  const rowsOf = ({ where }: { where: { userId: number } }) =>
    (where.userId === ACTOR_ID ? actorRoleIds : (roleIdsByUser[where.userId] ?? [])).map((roleId) => ({ userId: where.userId, roleId }));
  const userRolesRepo = { find: jest.fn(async (options: { where: { userId: number } }) => rowsOf(options)) };
  // The caller's transaction: its repository is a DIFFERENT object, so a test can tell which one was read.
  const txUserRoles = { find: jest.fn(async (options: { where: { userId: number } }) => rowsOf(options)) };
  const manager = { getRepository: jest.fn((entity: unknown) => (entity === UserRole ? txUserRoles : undefined)) };
  const service = new AssignmentBoundaryService(iam as any, userRolesRepo as any);
  return { service, iam, userRolesRepo, txUserRoles, manager };
}

const messageOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected the call to be refused');
};

describe('AssignmentBoundaryService.codesHeldBy', () => {
  it('reads the actor\'s CURRENT role ids and resolves the live union of what they (and the actor\'s own inline policies) grant', async () => {
    const { service, iam, userRolesRepo } = build({ held: ['VIEW_USER', 'CREATE_USER'], actorRoleIds: [10, 12] });

    const held = await service.codesHeldBy(DELEGATED);

    expect(userRolesRepo.find).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(iam.getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledTimes(1);
    expect(iam.getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledWith([10, 12], 7, undefined);
    expect(held).toEqual(new Set(['VIEW_USER', 'CREATE_USER']));
  });

  it('an actor with no role rows still asks, with the user id — the actor\'s own inline policies grant permissions too', async () => {
    const { service, iam } = build({ held: ['VIEW_USER'], actorRoleIds: [] });

    await expect(service.codesHeldBy(DELEGATED)).resolves.toEqual(new Set(['VIEW_USER']));

    expect(iam.getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledWith([], 7, undefined);
  });

  it('reads the actor\'s roles AND the policies through the caller\'s transaction when one is given — one connection, never the injected repository', async () => {
    const { service, iam, userRolesRepo, txUserRoles, manager } = build({ held: ['VIEW_USER'] });

    await service.codesHeldBy(DELEGATED, manager as any);

    expect(manager.getRepository).toHaveBeenCalledWith(UserRole);
    expect(txUserRoles.find).toHaveBeenCalledTimes(1);
    expect(userRolesRepo.find).not.toHaveBeenCalled();
    expect(iam.getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledWith([10], 7, manager);
  });

  it('the system actor holds nothing to compare against — an empty set, and no lookup at all', async () => {
    const { service, iam, userRolesRepo } = build({ held: ['VIEW_USER'] });

    await expect(service.codesHeldBy(SYSTEM_ACTOR)).resolves.toEqual(new Set());

    expect(userRolesRepo.find).not.toHaveBeenCalled();
    expect(iam.getActionCodesGrantedByPoliciesForRoles).not.toHaveBeenCalled();
  });
});

describe('AssignmentBoundaryService.excessOf', () => {
  it('lists, per role, the permissions it grants that are not held — sorted, so the message and the UI are stable', async () => {
    const { service } = build({ roleCodes: { 1: ['VIEW_LEDGER', 'APPROVE_PAYMENT', 'VIEW_USER'], 2: ['VIEW_USER'] } });

    const excess = await service.excessOf([1, 2], new Set(['VIEW_USER']));

    expect(excess.get(1)).toEqual(['APPROVE_PAYMENT', 'VIEW_LEDGER']);
    expect(excess.get(2)).toEqual([]);
  });

  it('a role that grants nothing — or that IamService does not know — is within every scope: an empty list, never undefined', async () => {
    const { service } = build({ roleCodes: { 1: ['VIEW_USER'] } });

    const excess = await service.excessOf([1, 2, 99], new Set(['VIEW_USER']));

    expect([...excess.keys()]).toEqual([1, 2, 99]);
    expect(excess.get(2)).toEqual([]);
    expect(excess.get(99)).toEqual([]);
  });

  it('holding nothing makes every granted code excess', async () => {
    const { service } = build({ roleCodes: { 1: ['B', 'A'] } });

    expect((await service.excessOf([1], new Set())).get(1)).toEqual(['A', 'B']);
  });

  it('compares the WHOLE list in ONE lookup, and leaves the held set untouched', async () => {
    const { service, iam } = build({ roleCodes: { 1: ['A'], 2: ['B'], 3: ['C'] } });
    const held = new Set(['A']);

    await service.excessOf([1, 2, 3], held);

    expect(iam.getActionCodesByRole).toHaveBeenCalledTimes(1);
    expect(iam.getActionCodesByRole).toHaveBeenCalledWith([1, 2, 3], undefined);
    expect([...held]).toEqual(['A']);
  });

  it('hands the caller\'s transaction on, so the role grants are read on the same connection', async () => {
    const { service, iam, manager } = build({ roleCodes: { 1: ['A'] } });

    await service.excessOf([1], new Set(), manager as any);

    expect(iam.getActionCodesByRole).toHaveBeenCalledWith([1], manager);
  });

  it('an empty list of roles is an empty answer', async () => {
    const { service } = build();

    expect((await service.excessOf([], new Set(['A']))).size).toBe(0);
  });
});

describe('AssignmentBoundaryService.assertWithinBoundary', () => {
  const FINANCE = { id: 1, roleName: 'FINANCE' };
  const SUPPORT = { id: 2, roleName: 'CUSTOMER_SUPPORT' };
  const EMPTY = { id: 3, roleName: 'EMPTY_ROLE' };

  it('lets a delegated administrator assign a role whose every permission it holds itself', async () => {
    const { service } = build({ held: ['VIEW_USER', 'APPROVE_PAYMENT', 'VIEW_LEDGER'], roleCodes: { 1: ['APPROVE_PAYMENT', 'VIEW_LEDGER'] } });

    await expect(service.assertWithinBoundary(DELEGATED, [FINANCE])).resolves.toBeUndefined();
  });

  it('lets it assign a role that grants nothing', async () => {
    const { service } = build({ held: [] });

    await expect(service.assertWithinBoundary(DELEGATED, [EMPTY])).resolves.toBeUndefined();
  });

  it('refuses (403) a role that grants a permission the administrator does not hold, naming the role and the permission', async () => {
    const { service } = build({ held: ['VIEW_USER'], roleCodes: { 1: ['VIEW_USER', 'APPROVE_PAYMENT'] } });

    const attempt = service.assertWithinBoundary(DELEGATED, [FINANCE]);

    await expect(attempt).rejects.toThrow(ForbiddenException);
    await expect(service.assertWithinBoundary(DELEGATED, [FINANCE])).rejects.toThrow(
      'Cannot assign the role "FINANCE": it grants permissions you do not hold (APPROVE_PAYMENT). ' +
        'A delegated administrator can only hand out permissions it holds itself.',
    );
  });

  it('one missing permission among many is enough — holding ALL BUT ONE is still outside the boundary', async () => {
    const { service } = build({ held: ['A', 'B', 'C'], roleCodes: { 1: ['A', 'B', 'C', 'D'] } });

    expect(await messageOf(service.assertWithinBoundary(DELEGATED, [FINANCE]))).toContain('(D)');
  });

  it('refuses the whole request when any ONE of several roles is beyond the scope, and names only that one', async () => {
    const { service } = build({ held: ['VIEW_USER'], roleCodes: { 1: ['APPROVE_PAYMENT'], 2: ['VIEW_USER'] } });

    const message = await messageOf(service.assertWithinBoundary(DELEGATED, [SUPPORT, FINANCE]));

    expect(message).toContain('"FINANCE"');
    expect(message).not.toContain('CUSTOMER_SUPPORT');
    expect(message).not.toContain('other role');
  });

  it('says so when several roles in the request are beyond the scope — the first is named, the rest are counted', async () => {
    const { service } = build({ held: [], roleCodes: { 1: ['A'], 2: ['B'], 3: ['C'] } });

    const two = await messageOf(service.assertWithinBoundary(DELEGATED, [FINANCE, SUPPORT]));
    const three = await messageOf(service.assertWithinBoundary(DELEGATED, [FINANCE, SUPPORT, EMPTY]));

    expect(two).toContain('"FINANCE"');
    expect(two).toContain('1 other role in this request is also beyond your scope.');
    // EMPTY_ROLE (id 3) grants 'C' here, so it is refused as well.
    expect(three).toContain('2 other roles in this request are also beyond your scope.');
  });

  it('names at most five permissions and counts the rest', async () => {
    const { service } = build({ held: [], roleCodes: { 1: ['G', 'F', 'E', 'D', 'C', 'B', 'A'] } });

    expect(await messageOf(service.assertWithinBoundary(DELEGATED, [FINANCE]))).toContain('(A, B, C, D, E and 2 more)');
  });

  it('compares against the permissions held RIGHT NOW — read live for this call, through the caller\'s transaction when there is one', async () => {
    const { service, iam, txUserRoles, userRolesRepo, manager } = build({ held: ['VIEW_USER'], actorRoleIds: [10, 11], roleCodes: { 1: ['VIEW_USER'] } });

    await service.assertWithinBoundary(DELEGATED, [FINANCE], manager as any);
    await service.assertWithinBoundary(DELEGATED, [FINANCE], manager as any);

    expect(txUserRoles.find).toHaveBeenCalledTimes(2);
    expect(userRolesRepo.find).not.toHaveBeenCalled();
    expect(iam.getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledTimes(2);
    expect(iam.getActionCodesGrantedByPoliciesForRoles).toHaveBeenLastCalledWith([10, 11], 7, manager);
    expect(iam.getActionCodesByRole).toHaveBeenLastCalledWith([1], manager);
  });

  it('a permission lost since the last request is lost here too — nothing is cached between calls', async () => {
    const { service, iam } = build({ roleCodes: { 1: ['APPROVE_PAYMENT'] } });
    iam.getActionCodesGrantedByPoliciesForRoles.mockResolvedValueOnce(new Set(['APPROVE_PAYMENT'])).mockResolvedValueOnce(new Set());

    await expect(service.assertWithinBoundary(DELEGATED, [FINANCE])).resolves.toBeUndefined();
    await expect(service.assertWithinBoundary(DELEGATED, [FINANCE])).rejects.toThrow(ForbiddenException);
  });

  describe('who is unbounded', () => {
    it('a SUPER_ADMIN holds every permission — it passes without any lookup', async () => {
      const { service, iam, userRolesRepo } = build({ held: [], roleCodes: { 1: ['APPROVE_PAYMENT'] } });

      await expect(service.assertWithinBoundary(SUPER_ADMIN, [FINANCE])).resolves.toBeUndefined();

      expect(userRolesRepo.find).not.toHaveBeenCalled();
      expect(iam.getActionCodesGrantedByPoliciesForRoles).not.toHaveBeenCalled();
      expect(iam.getActionCodesByRole).not.toHaveBeenCalled();
    });

    it('so does a user who holds SUPER_ADMIN only as a secondary role', async () => {
      const { service, iam } = build({ held: [], roleCodes: { 1: ['APPROVE_PAYMENT'] } });

      await expect(service.assertWithinBoundary(user(5, 'USER_MANAGER', 'SUPER_ADMIN'), [FINANCE])).resolves.toBeUndefined();

      expect(iam.getActionCodesByRole).not.toHaveBeenCalled();
    });

    it('and so does the boot-time system (the first administrator is seeded through the same grant path)', async () => {
      const { service, iam } = build({ held: [], roleCodes: { 1: ['APPROVE_PAYMENT'] } });

      await expect(service.assertWithinBoundary(SYSTEM_ACTOR, [FINANCE])).resolves.toBeUndefined();

      expect(iam.getActionCodesByRole).not.toHaveBeenCalled();
    });

    it('an ADMIN role is no exemption — a delegated administrator, whatever it is called, is bounded like anyone else', async () => {
      const { service } = build({ held: ['VIEW_USER'], roleCodes: { 1: ['APPROVE_PAYMENT'] } });

      await expect(service.assertWithinBoundary(user(8, 'ADMIN'), [FINANCE])).rejects.toThrow(ForbiddenException);
    });

    it('a look-alike role name is no exemption either', async () => {
      const { service } = build({ held: [], roleCodes: { 1: ['APPROVE_PAYMENT'] } });

      await expect(service.assertWithinBoundary(user(8, 'SUPER_ADMIN_VIEWER', 'super_admin'), [FINANCE])).rejects.toThrow(ForbiddenException);
    });
  });

  it('an empty list of roles asks nothing and passes — there is nothing to hand out', async () => {
    const { service, iam, userRolesRepo } = build();

    await expect(service.assertWithinBoundary(DELEGATED, [])).resolves.toBeUndefined();

    expect(userRolesRepo.find).not.toHaveBeenCalled();
    expect(iam.getActionCodesByRole).not.toHaveBeenCalled();
  });
});

describe('assignmentBoundaryMessage', () => {
  it('names the role and its missing permissions, and states the rule', () => {
    expect(assignmentBoundaryMessage([{ roleName: 'FINANCE', codes: ['APPROVE_PAYMENT', 'VIEW_LEDGER'] }])).toBe(
      'Cannot assign the role "FINANCE": it grants permissions you do not hold (APPROVE_PAYMENT, VIEW_LEDGER). ' +
        'A delegated administrator can only hand out permissions it holds itself.',
    );
  });

  it('five permissions are all named; a sixth is counted, not listed', () => {
    const five = assignmentBoundaryMessage([{ roleName: 'R', codes: ['A', 'B', 'C', 'D', 'E'] }]);
    const six = assignmentBoundaryMessage([{ roleName: 'R', codes: ['A', 'B', 'C', 'D', 'E', 'F'] }]);

    expect(five).toContain('(A, B, C, D, E)');
    expect(five).not.toContain('more');
    expect(six).toContain('(A, B, C, D, E and 1 more)');
    expect(six).not.toContain(', F');
  });

  it('other refused roles are counted in the singular and the plural', () => {
    const offending = (n: number) => Array.from({ length: n }, (_, i) => ({ roleName: `R${i}`, codes: ['A'] }));

    expect(assignmentBoundaryMessage(offending(2))).toContain('1 other role in this request is also beyond your scope.');
    expect(assignmentBoundaryMessage(offending(3))).toContain('2 other roles in this request are also beyond your scope.');
    expect(assignmentBoundaryMessage(offending(1))).not.toContain('other role');
  });
});

describe('AssignmentBoundaryService.codesHeldByUser', () => {
  it('asks for the roles of THAT account and resolves the union for it, with its own user id — the actor is not involved', async () => {
    const { service, iam, userRolesRepo } = build({ heldByUser: { 20: ['VIEW_LEDGER'] }, roleIdsByUser: { 20: [30, 31] } });

    await expect(service.codesHeldByUser(20)).resolves.toEqual(new Set(['VIEW_LEDGER']));

    expect(userRolesRepo.find).toHaveBeenCalledWith({ where: { userId: 20 } });
    expect(iam.getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledWith([30, 31], 20, undefined);
  });

  it('reads through the caller\'s transaction when one is given', async () => {
    const { service, iam, userRolesRepo, txUserRoles, manager } = build({ heldByUser: { 20: ['VIEW_LEDGER'] }, roleIdsByUser: { 20: [30] } });

    await service.codesHeldByUser(20, manager as any);

    expect(txUserRoles.find).toHaveBeenCalledTimes(1);
    expect(userRolesRepo.find).not.toHaveBeenCalled();
    expect(iam.getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledWith([30], 20, manager);
  });
});

// Taking over an account (resetting its password) hands the actor a working login for it — a grant of everything the account can do. So a
// delegated administrator may only do it to an account whose permissions it holds itself; otherwise RESET_USER_PASSWORD would sidestep the
// boundary on role assignment (reset a more privileged user's password, then sign in as them).
describe('AssignmentBoundaryService.assertAccountWithinBoundary', () => {
  const TARGET = 20;
  const ACTION = 'reset the password of';
  const ACTOR_HOLDS = ['VIEW_USER', 'CREATE_USER', 'RESET_USER_PASSWORD'];

  it('lets a delegated administrator take over an account whose every permission it holds itself', async () => {
    const { service } = build({ held: ACTOR_HOLDS, heldByUser: { [TARGET]: ['VIEW_USER', 'CREATE_USER'] }, roleIdsByUser: { [TARGET]: [30] } });

    await expect(service.assertAccountWithinBoundary(DELEGATED, TARGET, ACTION)).resolves.toBeUndefined();
  });

  it('lets it take over an account that holds nothing (a brand-new or role-less account)', async () => {
    const { service } = build({ held: ACTOR_HOLDS, heldByUser: { [TARGET]: [] } });

    await expect(service.assertAccountWithinBoundary(DELEGATED, TARGET, ACTION)).resolves.toBeUndefined();
  });

  it('refuses (403) an account that holds even ONE permission the administrator does not — and names no permission in the refusal', async () => {
    const { service } = build({
      held: ACTOR_HOLDS,
      heldByUser: { [TARGET]: ['VIEW_USER', 'APPROVE_PAYMENT'] },
      roleIdsByUser: { [TARGET]: [30] },
    });

    await expect(service.assertAccountWithinBoundary(DELEGATED, TARGET, ACTION)).rejects.toThrow(ForbiddenException);
    const message = await messageOf(service.assertAccountWithinBoundary(DELEGATED, TARGET, ACTION));
    expect(message).toBe(accountBoundaryMessage(ACTION));
    expect(message).not.toContain('APPROVE_PAYMENT');
  });

  it('the account\'s OWN inline policies count — an account whose roles fit but whose own inline policy grants more is refused', async () => {
    // IamService resolves roles + the account's own inline policies in one union, so the answer for the account already includes them.
    const { service } = build({ held: ACTOR_HOLDS, heldByUser: { [TARGET]: ['VIEW_USER', 'EXTRA_INLINE_GRANT'] }, roleIdsByUser: { [TARGET]: [30] } });

    await expect(service.assertAccountWithinBoundary(DELEGATED, TARGET, ACTION)).rejects.toThrow(ForbiddenException);
  });

  it('reads BOTH sides live for the call — the actor\'s permissions and the account\'s — through the caller\'s transaction when there is one', async () => {
    const { service, iam, userRolesRepo, txUserRoles, manager } = build({
      held: ACTOR_HOLDS,
      heldByUser: { [TARGET]: ['VIEW_USER'] },
      roleIdsByUser: { [TARGET]: [30] },
    });

    await service.assertAccountWithinBoundary(DELEGATED, TARGET, ACTION, manager as any);

    expect(txUserRoles.find).toHaveBeenCalledTimes(2); // the actor's role rows, then the account's
    expect(userRolesRepo.find).not.toHaveBeenCalled();
    expect(iam.getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledWith([10], ACTOR_ID, manager);
    expect(iam.getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledWith([30], TARGET, manager);
  });

  it('a permission the account gained since the last request is seen — nothing is cached between calls', async () => {
    const { service, iam } = build({ held: ACTOR_HOLDS, roleIdsByUser: { [TARGET]: [30] } });
    iam.getActionCodesGrantedByPoliciesForRoles
      .mockResolvedValueOnce(new Set(ACTOR_HOLDS)) // the actor, first call
      .mockResolvedValueOnce(new Set(['VIEW_USER'])) // the account, first call
      .mockResolvedValueOnce(new Set(ACTOR_HOLDS)) // the actor, second call
      .mockResolvedValueOnce(new Set(['VIEW_USER', 'APPROVE_PAYMENT'])); // the account, second call — it has been promoted meanwhile

    await expect(service.assertAccountWithinBoundary(DELEGATED, TARGET, ACTION)).resolves.toBeUndefined();
    await expect(service.assertAccountWithinBoundary(DELEGATED, TARGET, ACTION)).rejects.toThrow(ForbiddenException);
  });

  describe('who is unbounded', () => {
    it('a SUPER_ADMIN may take over any account — no lookup at all', async () => {
      const { service, iam, userRolesRepo } = build({ heldByUser: { [TARGET]: ['APPROVE_PAYMENT'] } });

      await expect(service.assertAccountWithinBoundary(SUPER_ADMIN, TARGET, ACTION)).resolves.toBeUndefined();

      expect(userRolesRepo.find).not.toHaveBeenCalled();
      expect(iam.getActionCodesGrantedByPoliciesForRoles).not.toHaveBeenCalled();
    });

    it('so does the boot-time system, and a user who holds SUPER_ADMIN only as a secondary role', async () => {
      const { service, iam } = build({ heldByUser: { [TARGET]: ['APPROVE_PAYMENT'] } });

      await expect(service.assertAccountWithinBoundary(SYSTEM_ACTOR, TARGET, ACTION)).resolves.toBeUndefined();
      await expect(service.assertAccountWithinBoundary(user(5, 'USER_MANAGER', 'SUPER_ADMIN'), TARGET, ACTION)).resolves.toBeUndefined();

      expect(iam.getActionCodesGrantedByPoliciesForRoles).not.toHaveBeenCalled();
    });

    it('nobody is "beyond" their own account — no lookup', async () => {
      const { service, iam } = build({ held: [] });

      await expect(service.assertAccountWithinBoundary(DELEGATED, ACTOR_ID, ACTION)).resolves.toBeUndefined();

      expect(iam.getActionCodesGrantedByPoliciesForRoles).not.toHaveBeenCalled();
    });

    it('a role merely NAMED ADMIN (or a look-alike of SUPER_ADMIN) is no exemption', async () => {
      const { service } = build({ held: ['VIEW_USER'], heldByUser: { [TARGET]: ['APPROVE_PAYMENT'] } });

      await expect(service.assertAccountWithinBoundary(user(8, 'ADMIN'), TARGET, ACTION)).rejects.toThrow(ForbiddenException);
      await expect(service.assertAccountWithinBoundary(user(8, 'SUPER_ADMIN_VIEWER', 'super_admin'), TARGET, ACTION)).rejects.toThrow(ForbiddenException);
    });
  });
});

describe('accountBoundaryMessage', () => {
  it('completes "Cannot …" with the action, states the rule, and names no permission', () => {
    expect(accountBoundaryMessage('reset the password of')).toBe(
      'Cannot reset the password of this account: it holds permissions you do not hold. ' +
        'A delegated administrator can only take over an account whose permissions it holds itself.',
    );
  });
});
