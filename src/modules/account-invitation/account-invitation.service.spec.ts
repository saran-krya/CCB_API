import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';
import { ADMINISTRATOR_ROLES } from '../../common/security/administrator-roles';
import { INVITATION_MESSAGE, INVITATION_PRINCIPAL } from './account-invitation.constants';
import { AccountInvitationService } from './account-invitation.service';
import { InviteStaffDto } from './dto/account-invitation.dto';

/**
 * Staff invitations belong to the Administration Console: only a SUPER_ADMIN may invite, re-send to, cancel for or list staff accounts. The
 * Users permission codes already stop every other role (IamService drops them), and the service checks the role as well — so the rule holds
 * even for a principal that somehow holds every code. These tests give such a principal ALL the codes and show each entry point still refuses
 * before it touches anything else.
 */

const SUPER_ADMIN = ADMINISTRATOR_ROLES[0];
const everyUserCode = [ACTION_CODES.CREATE_USER, ACTION_CODES.EDIT_USER, ACTION_CODES.VIEW_USER, ACTION_CODES.RESET_USER_PASSWORD, ACTION_CODES.VIEW_CUSTOMER, ACTION_CODES.EDIT_CUSTOMER];

const principal = (roleNames: string[]): AuthenticatedUser => ({
  sub: 7,
  email: 'someone@example.com',
  roleId: 1,
  roleName: roleNames[0],
  roleIds: [1],
  roleNames,
  type: 'staff',
});

function build(options: { invitation?: { id: number; principalType: string; principalId: number } } = {}) {
  const used: string[] = [];
  // Any dependency other than the two stubbed below fails the test if it is called at all.
  const untouchable = new Proxy(
    {},
    {
      get: (_target, property) => () => {
        used.push(String(property));
        throw new Error(`unexpected use of a dependency: ${String(property)}`);
      },
    },
  );
  const iam = { getActionCodesGrantedByPoliciesForRoles: jest.fn().mockResolvedValue(new Set(everyUserCode)) };
  const invitations = { findOne: jest.fn().mockResolvedValue(options.invitation ?? null) };
  const service = new AccountInvitationService(
    invitations as never, // invitations repository
    untouchable as never, // user rows
    untouchable as never, // data source
    untouchable as never, // config
    untouchable as never, // mail
    untouchable as never, // templates
    untouchable as never, // audit
    untouchable as never, // users
    untouchable as never, // user roles
    untouchable as never, // customers
    iam as never,
  );
  return { service, iam, invitations, used };
}

const details = { firstName: 'Sara', lastName: 'Ahmed', email: 'sara@example.com', roleIds: [12] } as InviteStaffDto;
const notSuperAdmin = principal(['ADMIN']);

describe('AccountInvitationService — staff invitations are SUPER_ADMIN-only', () => {
  it('refuses to create a staff invitation for anyone who is not a SUPER_ADMIN, even holding every permission code', async () => {
    const { service, used } = build();
    await expect(service.inviteStaff(details, notSuperAdmin)).rejects.toThrow(new ForbiddenException(INVITATION_MESSAGE.STAFF_SUPER_ADMIN_ONLY));
    expect(used).toEqual([]);
  });

  it('refuses to send an invitation to an existing staff account', async () => {
    const { service, used } = build();
    await expect(service.inviteExistingStaff(9, notSuperAdmin)).rejects.toThrow(new ForbiddenException(INVITATION_MESSAGE.STAFF_SUPER_ADMIN_ONLY));
    expect(used).toEqual([]);
  });

  it('refuses to re-send a staff invitation', async () => {
    const { service, used } = build({ invitation: { id: 5, principalType: INVITATION_PRINCIPAL.STAFF, principalId: 9 } });
    await expect(service.resend(5, notSuperAdmin)).rejects.toThrow(new ForbiddenException(INVITATION_MESSAGE.STAFF_SUPER_ADMIN_ONLY));
    expect(used).toEqual([]);
  });

  it('refuses to cancel a staff invitation', async () => {
    const { service, used } = build({ invitation: { id: 5, principalType: INVITATION_PRINCIPAL.STAFF, principalId: 9 } });
    await expect(service.cancel(5, notSuperAdmin)).rejects.toThrow(new ForbiddenException(INVITATION_MESSAGE.STAFF_SUPER_ADMIN_ONLY));
    expect(used).toEqual([]);
  });

  it('does not list staff invitations for a caller who is not a SUPER_ADMIN, even with VIEW_USER', async () => {
    const { service, used } = build();
    await expect(service.list({ page: 1, limit: 10, principalType: INVITATION_PRINCIPAL.STAFF }, notSuperAdmin)).rejects.toThrow(
      new ForbiddenException(INVITATION_MESSAGE.MAY_NOT_VIEW),
    );
    expect(used).toEqual([]);
  });

  it('recognises a SUPER_ADMIN (the check is by the live role name, exact match)', () => {
    const { service } = build();
    const check = (who: AuthenticatedUser) => () => (service as unknown as { assertSuperAdmin(p: AuthenticatedUser): void }).assertSuperAdmin(who);
    expect(check(principal([SUPER_ADMIN]))).not.toThrow();
    expect(check(principal(['MANAGER', SUPER_ADMIN]))).not.toThrow();
    expect(check(principal(['super_admin']))).toThrow(ForbiddenException);
    expect(check(principal(['ADMIN']))).toThrow(ForbiddenException);
  });
});
