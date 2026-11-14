import { UnauthorizedException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

// AuthService.login previously SKIPPED bcrypt.compare entirely whenever there was no real password hash to
// compare against (`!!x.passwordHash && (await bcrypt.compare(...))`) — a non-existent e-mail, or an existing
// account whose sign-in was disabled (passwordHash: null), then answered measurably FASTER than one with a real,
// active password (bcrypt's own cost factor is by far the slowest step, ~100-300ms), even though every path
// returns the identical "Invalid credentials" message. That timing gap is enough to enumerate which e-mails have
// real, active accounts. Fixed: bcrypt.compare now always runs, against a fixed dummy hash when there is no real
// one, so every "invalid" outcome pays the same bcrypt cost regardless of WHY it is invalid.
jest.mock('bcryptjs', () => ({ compare: jest.fn().mockResolvedValue(false), hash: jest.fn().mockResolvedValue('dummy-hash') }));

function build() {
  const users = { findByEmailWithPasswordHash: jest.fn() };
  const customers = { findByEmailForLogin: jest.fn() };
  const attempts = { assertAllowed: jest.fn().mockResolvedValue(undefined), recordFailure: jest.fn().mockResolvedValue(undefined) };
  const service = new AuthService(
    users as any,
    {} as any, // UserRoleService — never reached, every case here throws before it
    customers as any,
    {} as any, // JwtService
    {} as any, // ConfigService
    {} as any, // AttributeService
    {} as any, // LovService
    {} as any, // RegistrationRequestService
    {} as any, // AuditService
    {} as any, // RefreshToken repository
    {} as any, // UserDevice repository
    {} as any, // UserLoginHistory repository
    attempts as any,
  );
  return { service, users, customers };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const compare = bcrypt.compare as unknown as jest.Mock;

describe('AuthService.login — bcrypt.compare always runs, even with no real hash to compare against', () => {
  it('an e-mail matching NO staff user and NO customer still pays a real bcrypt.compare, against the dummy hash', async () => {
    const t = build();
    t.users.findByEmailWithPasswordHash.mockResolvedValue(null);
    t.customers.findByEmailForLogin.mockResolvedValue(null);

    await expect(t.service.login({ email: 'nobody@example.test', password: 'whatever' } as any)).rejects.toThrow(UnauthorizedException);

    expect(compare).toHaveBeenCalledWith('whatever', 'dummy-hash');
  });

  it('an existing STAFF account with sign-in disabled (passwordHash: null) still pays a real bcrypt.compare', async () => {
    const t = build();
    t.users.findByEmailWithPasswordHash.mockResolvedValue({ id: 5, email: 'staff@example.test', passwordHash: null, active: true });

    await expect(t.service.login({ email: 'staff@example.test', password: 'whatever' } as any)).rejects.toThrow(UnauthorizedException);

    expect(compare).toHaveBeenCalledWith('whatever', 'dummy-hash');
  });

  it('an existing CUSTOMER account with no password set (passwordHash: null) still pays a real bcrypt.compare', async () => {
    const t = build();
    t.users.findByEmailWithPasswordHash.mockResolvedValue(null);
    t.customers.findByEmailForLogin.mockResolvedValue({ id: 9, email: 'customer@example.test', passwordHash: null });

    await expect(t.service.login({ email: 'customer@example.test', password: 'whatever' } as any)).rejects.toThrow(UnauthorizedException);

    expect(compare).toHaveBeenCalledWith('whatever', 'dummy-hash');
  });
});
