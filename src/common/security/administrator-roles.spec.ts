import { ROLES } from '../constants/global';
import {
  Actor,
  SUPER_ADMIN_ASSIGN_MESSAGE,
  SUPER_ADMIN_MODIFY_MESSAGE,
  SYSTEM_ACTOR,
  actorUserId,
  initialSuperAdminProtectedMessage,
  isSuperAdminActor,
} from './actor';
import { ADMINISTRATOR_ROLES, administratorRolesAmong, isAdministratorRoleName } from './administrator-roles';

// Pure logic only: no database, no server, no file system. Written to be RUN LATER, by the people who will verify the implementation.
// A customer's CCB installation has ONE administrator role: SUPER_ADMIN, the customer's own highest administrator. A delegated
// administrator (an "ADMIN") is an ordinary dynamic role — it is never part of the administrator list and never a super administrator.

const staff = (id: number): Actor => ({ kind: 'user', id, roleNames: ['USER_MANAGER'] });
const superAdmin = (id: number): Actor => ({ kind: 'user', id, roleNames: ['SUPER_ADMIN'] });
/** A delegated administrator: a role that happens to be called ADMIN. */
const delegatedAdmin = (id: number): Actor => ({ kind: 'user', id, roleNames: ['ADMIN'] });

describe('the administrator role', () => {
  it('is exactly one predefined role, SUPER_ADMIN — no GLOBAL_ADMIN and no CLIENT_ADMIN exist', () => {
    expect(ROLES).toEqual({ SUPER_ADMIN: 'SUPER_ADMIN' });
    expect(ADMINISTRATOR_ROLES).toEqual(['SUPER_ADMIN']);
  });

  it('is recognised by EXACT name only — the database compares role names loosely, so a look-alike must never pass as an administrator', () => {
    expect(isAdministratorRoleName('SUPER_ADMIN')).toBe(true);
    for (const lookAlike of ['super_admin', 'Super_Admin', ' SUPER_ADMIN', 'SUPER_ADMIN ', 'SUPER_ADMİN', 'SUPER-ADMIN', 'SUPERADMIN', 'GLOBAL_ADMIN', 'CLIENT_ADMIN', 'ADMIN', 'FINANCE', '']) {
      expect(isAdministratorRoleName(lookAlike)).toBe(false);
    }
    expect(isAdministratorRoleName(null)).toBe(false);
    expect(isAdministratorRoleName(undefined)).toBe(false);
  });

  it('is picked out of a list of role names, once, ignoring every other role', () => {
    expect(administratorRolesAmong(['ADMIN', 'FINANCE', 'SUPER_ADMIN', 'SUPER_ADMIN'])).toEqual(['SUPER_ADMIN']);
    expect(administratorRolesAmong(['ADMIN', 'OPERATIONS'])).toEqual([]);
    expect(administratorRolesAmong([])).toEqual([]);
  });
});

describe('who may manage the SUPER_ADMIN role (isSuperAdminActor)', () => {
  it('a SUPER_ADMIN and the boot-time system may — nobody else', () => {
    expect(isSuperAdminActor(superAdmin(1))).toBe(true);
    expect(isSuperAdminActor(SYSTEM_ACTOR)).toBe(true);
  });

  it('a delegated administrator ("ADMIN") may NOT, however many user-management permissions it holds — those are delegable, this is not', () => {
    expect(isSuperAdminActor(delegatedAdmin(2))).toBe(false);
    expect(isSuperAdminActor(staff(3))).toBe(false);
  });

  it('holding SUPER_ADMIN as ONE of several roles is enough', () => {
    expect(isSuperAdminActor({ kind: 'user', id: 4, roleNames: ['FINANCE', 'SUPER_ADMIN'] })).toBe(true);
  });

  it('a look-alike role name does not make an actor a super administrator', () => {
    expect(isSuperAdminActor({ kind: 'user', id: 5, roleNames: ['super_admin'] })).toBe(false);
    expect(isSuperAdminActor({ kind: 'user', id: 5, roleNames: ['GLOBAL_ADMIN'] })).toBe(false);
    expect(isSuperAdminActor({ kind: 'user', id: 5, roleNames: ['CLIENT_ADMIN'] })).toBe(false);
  });

  it('the refusal messages name the role', () => {
    expect(SUPER_ADMIN_ASSIGN_MESSAGE).toBe('Only SUPER_ADMIN can assign the SUPER_ADMIN role.');
    expect(SUPER_ADMIN_MODIFY_MESSAGE).toBe('Only SUPER_ADMIN can modify a SUPER_ADMIN account.');
  });

  it('the INITIAL-administrator refusal completes "Cannot …", says why the account is protected and points at the maintenance tool', () => {
    for (const action of ['delete', 'deactivate', 'demote', 'disable the sign-in access of']) {
      const message = initialSuperAdminProtectedMessage(action);

      expect(message.startsWith(`Cannot ${action} the initial SUPER_ADMIN account`)).toBe(true);
      expect(message).toContain('an installation can never lose its owner by accident');
      expect(message).toContain('server maintenance tool');
      expect(message).toContain('docs/ON_PREMISE_SUPER_ADMIN.md');
    }
  });

  it('the audit user id is the signed-in user, never the system', () => {
    expect(actorUserId(superAdmin(7))).toBe(7);
    expect(actorUserId(SYSTEM_ACTOR)).toBeUndefined();
  });
});
