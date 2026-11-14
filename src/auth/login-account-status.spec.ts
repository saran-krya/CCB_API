import { ForbiddenException, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CustomerAccountStatus } from '../modules/customer/entities/customer.entity';

// AuthService.login — the "authenticated identity, refused standing" branches (a CORRECT password for an account
// whose status currently refuses sign-in: a deactivated staff account, an overdue customer account). Unlike a
// wrong-password guess (LOGIN_FAILED), this proves the caller already knows the real password, so it is recorded
// as its own security event (SIGNIN_BLOCKED_ACCOUNT_STATUS) rather than folded into the lock-out counters —
// counting it as a guess would be wrong (and would wrongly tighten this account's OWN lock-out from an attempt
// that was never a guess at all). No prior spec exercised either branch of login() at all before this.
jest.mock('bcryptjs', () => ({ compare: jest.fn().mockResolvedValue(true), hash: jest.fn() }));

const PASSWORD = 'Correct-Horse-Battery-Staple1!';

function build() {
  const users = {
    findByEmailWithPasswordHash: jest.fn(),
    updateLastLogin: jest.fn().mockResolvedValue(undefined),
  };
  const customers = {
    findByEmailForLogin: jest.fn(),
  };
  const userRoles = { getPrimaryRole: jest.fn() };
  const attempts = {
    assertAllowed: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
  };
  const security = { record: jest.fn().mockResolvedValue(undefined) };
  const loginHistory = { insert: jest.fn().mockResolvedValue(undefined), create: jest.fn((v) => v), save: jest.fn() };
  const service = new AuthService(
    users as any,
    userRoles as any,
    customers as any,
    {} as any, // JwtService — never reached, both branches throw first
    {} as any, // ConfigService
    {} as any, // AttributeService
    {} as any, // LovService
    {} as any, // RegistrationRequestService
    {} as any, // AuditService
    {} as any, // RefreshToken repository
    {} as any, // UserDevice repository
    loginHistory as any,
    attempts as any,
    undefined, // SessionLivenessService
    security as any,
  );
  return { service, users, customers, userRoles, attempts, security };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('AuthService.login — account-status refusals after a CORRECT password', () => {
  it('refuses (403) a deactivated staff account and records SIGNIN_BLOCKED_ACCOUNT_STATUS — never counted as a failed guess', async () => {
    const t = build();
    t.users.findByEmailWithPasswordHash.mockResolvedValue({ id: 42, email: 'staff@example.test', passwordHash: 'hashed', active: false });

    await expect(t.service.login({ email: 'staff@example.test', password: PASSWORD } as any)).rejects.toThrow(ForbiddenException);

    expect(t.attempts.recordFailure).not.toHaveBeenCalled();
    expect(t.security.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SIGNIN_BLOCKED_ACCOUNT_STATUS', entityId: 42, details: expect.objectContaining({ reason: 'inactive' }) }),
    );
  });

  it('refuses (403) an overdue customer account and records SIGNIN_BLOCKED_ACCOUNT_STATUS — never counted as a failed guess', async () => {
    const t = build();
    t.users.findByEmailWithPasswordHash.mockResolvedValue(null);
    t.customers.findByEmailForLogin.mockResolvedValue({
      id: 7,
      email: 'customer@example.test',
      passwordHash: 'hashed',
      accountStatus: CustomerAccountStatus.OVERDUE,
    });

    await expect(t.service.login({ email: 'customer@example.test', password: PASSWORD } as any)).rejects.toThrow(ForbiddenException);

    expect(t.attempts.recordFailure).not.toHaveBeenCalled();
    expect(t.security.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SIGNIN_BLOCKED_ACCOUNT_STATUS', entityId: 7, details: expect.objectContaining({ reason: 'overdue' }) }),
    );
  });

  it('a wrong password for an inactive account is still an ordinary LOGIN_FAILED — status is never exposed before the password is confirmed', async () => {
    const t = build();
    const bcrypt = jest.requireMock('bcryptjs') as { compare: jest.Mock };
    bcrypt.compare.mockResolvedValueOnce(false);
    t.users.findByEmailWithPasswordHash.mockResolvedValue({ id: 42, email: 'staff@example.test', passwordHash: 'hashed', active: false });

    await expect(t.service.login({ email: 'staff@example.test', password: 'wrong' } as any)).rejects.toThrow('Invalid credentials');

    expect(t.security.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN_FAILED' }));
    expect(t.security.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'SIGNIN_BLOCKED_ACCOUNT_STATUS' }));
  });
});
