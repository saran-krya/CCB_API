import { ForbiddenException, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Actor, initialSuperAdminProtectedMessage, SUPER_ADMIN_MODIFY_MESSAGE } from '../common/security/actor';

// bcrypt at cost 12 is deliberately slow; this suite is about WHO may reset or disable, not about hashing.
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed-password'), compare: jest.fn() }));

// The admin credential actions on ANOTHER staff user's account (Manage sign-in access). RESET_USER_PASSWORD hands the actor a working login for
// the account, so a reset is held to the same ASSIGNMENT BOUNDARY as handing out a role (UserRoleService.assertActorMayTakeOverAccount) — and
// disabling sign-in never touches the installation's INITIAL administrator. The rules themselves live in UserRoleService and are tested there;
// here: that AuthService asks them, in the right order, and that a refusal writes nothing. Written, never run.

const ADMIN: Actor = { kind: 'user', id: 80, roleNames: ['ADMIN'] };
const SUPER_ADMIN: Actor = { kind: 'user', id: 1, roleNames: ['SUPER_ADMIN'] };
const TARGET_ID = 9;
const NEW_PASSWORD = 'A-Long-New-Passw0rd!';

function build() {
  const users = {
    findOne: jest.fn().mockResolvedValue({ id: TARGET_ID, email: 'target@example.test' }),
    adminSetPasswordHash: jest.fn().mockResolvedValue(undefined),
    clearPasswordHash: jest.fn().mockResolvedValue(undefined),
  };
  const userRoles = {
    assertActorMayModifyUser: jest.fn().mockResolvedValue(undefined),
    assertActorMayTakeOverAccount: jest.fn().mockResolvedValue(undefined),
    assertNotInitialAdministrator: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AuthService(
    users as any,
    userRoles as any,
    {} as any, // CustomerService
    {} as any, // JwtService
    {} as any, // ConfigService
    {} as any, // AttributeService
    {} as any, // LovService
    {} as any, // RegistrationRequestService
    audit as any,
    {} as any, // RefreshToken repository
    {} as any, // UserDevice repository
    {} as any, // UserLoginHistory repository
  );
  return { service, users, userRoles, audit };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AuthService.adminResetPassword — a reset hands the actor a login, so it is bounded like a role grant', () => {
  it('asks whether the account is a SUPER_ADMIN account, THEN whether it is within the actor\'s scope, BEFORE anything is written', async () => {
    const t = build();

    await t.service.adminResetPassword(TARGET_ID, { newPassword: NEW_PASSWORD } as any, ADMIN);

    expect(t.userRoles.assertActorMayModifyUser).toHaveBeenCalledWith(ADMIN, TARGET_ID);
    expect(t.userRoles.assertActorMayTakeOverAccount).toHaveBeenCalledWith(ADMIN, TARGET_ID, 'reset the password of');
    const [modifyOrder] = t.userRoles.assertActorMayModifyUser.mock.invocationCallOrder;
    const [takeOverOrder] = t.userRoles.assertActorMayTakeOverAccount.mock.invocationCallOrder;
    const [writeOrder] = t.users.adminSetPasswordHash.mock.invocationCallOrder;
    expect(modifyOrder).toBeLessThan(takeOverOrder);
    expect(takeOverOrder).toBeLessThan(writeOrder);
  });

  it('a refusal by the scope check writes NOTHING — no password hash, no audit row', async () => {
    const t = build();
    t.userRoles.assertActorMayTakeOverAccount.mockRejectedValue(new ForbiddenException('beyond your scope'));

    await expect(t.service.adminResetPassword(TARGET_ID, { newPassword: NEW_PASSWORD } as any, ADMIN)).rejects.toThrow('beyond your scope');

    expect(t.users.adminSetPasswordHash).not.toHaveBeenCalled();
    expect(t.audit.record).not.toHaveBeenCalled();
  });

  it('a SUPER_ADMIN account is refused first, with its own message, and the scope check is never reached', async () => {
    const t = build();
    t.userRoles.assertActorMayModifyUser.mockRejectedValue(new ForbiddenException(SUPER_ADMIN_MODIFY_MESSAGE));

    await expect(t.service.adminResetPassword(TARGET_ID, { newPassword: NEW_PASSWORD } as any, ADMIN)).rejects.toThrow(SUPER_ADMIN_MODIFY_MESSAGE);

    expect(t.userRoles.assertActorMayTakeOverAccount).not.toHaveBeenCalled();
    expect(t.users.adminSetPasswordHash).not.toHaveBeenCalled();
  });

  it('resetting your OWN password through the admin route is refused before any rule is asked', async () => {
    const t = build();

    await expect(t.service.adminResetPassword(80, { newPassword: NEW_PASSWORD } as any, ADMIN)).rejects.toThrow('Use "Change password" to change your own password.');

    expect(t.userRoles.assertActorMayModifyUser).not.toHaveBeenCalled();
    expect(t.userRoles.assertActorMayTakeOverAccount).not.toHaveBeenCalled();
    expect(t.users.adminSetPasswordHash).not.toHaveBeenCalled();
  });

  it('on success: stores only a hash, forces a change at the next sign-in by default, and audits without the password', async () => {
    const t = build();

    const result = await t.service.adminResetPassword(TARGET_ID, { newPassword: NEW_PASSWORD } as any, ADMIN);

    expect(t.users.adminSetPasswordHash).toHaveBeenCalledWith(TARGET_ID, 'hashed-password', true);
    expect(result).toMatchObject({ userId: TARGET_ID, mustChangePassword: true, sessionsRevoked: false });
    expect(result.generatedPassword).toBeUndefined(); // the admin chose it, so nothing is handed back
    expect(t.audit.record).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(t.audit.record.mock.calls)).not.toContain(NEW_PASSWORD);
    expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ADMIN_RESET_PASSWORD', entityId: TARGET_ID, performedBy: 80 }));
  });

  it('without a password in the request one is generated, returned ONCE, and still never written to the audit row', async () => {
    const t = build();

    const result = await t.service.adminResetPassword(TARGET_ID, {} as any, ADMIN);

    expect(typeof result.generatedPassword).toBe('string');
    expect(result.generatedPassword!.length).toBeGreaterThanOrEqual(12);
    expect(JSON.stringify(t.audit.record.mock.calls)).not.toContain(result.generatedPassword!);
  });

  it('a SUPER_ADMIN actor goes through the same two questions (UserRoleService answers "yes" for it without a lookup)', async () => {
    const t = build();

    await t.service.adminResetPassword(TARGET_ID, { newPassword: NEW_PASSWORD } as any, SUPER_ADMIN);

    expect(t.userRoles.assertActorMayTakeOverAccount).toHaveBeenCalledWith(SUPER_ADMIN, TARGET_ID, 'reset the password of');
    expect(t.users.adminSetPasswordHash).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.disableSigninAccess — the INITIAL administrator is never locked out', () => {
  it('asks UserRoleService whether the account is the initial administrator, after the SUPER_ADMIN-account rule and before anything is cleared', async () => {
    const t = build();

    await t.service.disableSigninAccess(TARGET_ID, false, SUPER_ADMIN);

    expect(t.userRoles.assertNotInitialAdministrator).toHaveBeenCalledWith(TARGET_ID, 'disable the sign-in access of');
    const [modifyOrder] = t.userRoles.assertActorMayModifyUser.mock.invocationCallOrder;
    const [initialOrder] = t.userRoles.assertNotInitialAdministrator.mock.invocationCallOrder;
    const [clearOrder] = t.users.clearPasswordHash.mock.invocationCallOrder;
    expect(modifyOrder).toBeLessThan(initialOrder);
    expect(initialOrder).toBeLessThan(clearOrder);
  });

  it('refuses (403) to disable the sign-in access of the initial administrator — nothing is cleared, nothing audited', async () => {
    const t = build();
    t.userRoles.assertNotInitialAdministrator.mockRejectedValue(new ForbiddenException(initialSuperAdminProtectedMessage('disable the sign-in access of')));

    await expect(t.service.disableSigninAccess(TARGET_ID, false, SUPER_ADMIN)).rejects.toThrow(
      initialSuperAdminProtectedMessage('disable the sign-in access of'),
    );

    expect(t.users.clearPasswordHash).not.toHaveBeenCalled();
    expect(t.audit.record).not.toHaveBeenCalled();
  });

  it('disabling your OWN sign-in access is refused before any rule is asked', async () => {
    const t = build();

    await expect(t.service.disableSigninAccess(1, false, SUPER_ADMIN)).rejects.toThrow('You cannot disable your own sign-in access.');

    expect(t.userRoles.assertNotInitialAdministrator).not.toHaveBeenCalled();
    expect(t.users.clearPasswordHash).not.toHaveBeenCalled();
  });

  it('for any other account it clears the password hash and records DISABLE_SIGNIN_ACCESS', async () => {
    const t = build();

    await expect(t.service.disableSigninAccess(TARGET_ID, false, SUPER_ADMIN)).resolves.toEqual({ sessionsRevoked: false });

    expect(t.users.clearPasswordHash).toHaveBeenCalledWith(TARGET_ID);
    expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'DISABLE_SIGNIN_ACCESS', entityId: TARGET_ID, performedBy: 1 }));
  });
});
