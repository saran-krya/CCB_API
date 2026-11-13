import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { CustomerAccountStatus } from '../../modules/customer/entities/customer.entity';

// Isolated tests for JwtStrategy.validate's STALE-CLAIM rule: authorization must never trust role
// claims inside the JWT. For a staff token the strategy re-reads the user's CURRENT state — active flag,
// live role set and whether a password change is still required — from the database on every request
// (UserService.findAuthState, two lean queries) and attaches it to the request principal as
// roleIds/roleNames/mustChangePassword — assignment order, index 0 = primary — overriding the token's
// singular roleId/roleName with the live primary. A role revoked or granted after the token was issued
// therefore takes effect on the very next request made with the SAME token, and a user left with no role
// is rejected outright. Every dependency is stubbed; no real database connection.
describe('JwtStrategy.validate — live roles, never token claims', () => {
  let users: { findAuthState: jest.Mock; findOne: jest.Mock };
  let customers: { findOne: jest.Mock };
  let sessions: { isLive: jest.Mock };
  let strategy: JwtStrategy;

  const SUPER_ADMIN = { id: 1, roleName: 'SUPER_ADMIN' };
  const FINANCE = { id: 3, roleName: 'FINANCE' };
  const OPERATIONS = { id: 4, roleName: 'OPERATIONS' };

  beforeEach(() => {
    users = { findAuthState: jest.fn(), findOne: jest.fn() };
    customers = { findOne: jest.fn() };
    // The tokens in this describe carry no `sid`, so session binding is skipped and this is never consulted — the
    // session rules have their own describe below.
    sessions = { isLive: jest.fn().mockResolvedValue(true) };
    const config = { getOrThrow: jest.fn().mockReturnValue('test-secret-test-secret-test-secret') };
    strategy = new JwtStrategy(config as never, users as never, customers as never, sessions as never);
  });

  /** A signed staff token's payload — roleId/roleName are the primary role AT ISSUE TIME. */
  const staffToken = (overrides: Record<string, unknown> = {}) =>
    ({ sub: 7, email: 'staff@ccb.local', roleId: FINANCE.id, roleName: FINANCE.roleName, type: 'staff', iat: 1_700_000_000, exp: 1_900_000_000, ...overrides }) as never;

  /** What UserService.findAuthState returns: the live flags plus `roles` (all, in assignment order). */
  const liveState = (roles: { id: number; roleName: string }[], overrides: Record<string, unknown> = {}) => ({
    id: 7,
    active: true,
    mustChangePassword: false,
    roles,
    ...overrides,
  });

  describe('staff — the live role set replaces whatever the token claimed', () => {
    it('attaches roleIds/roleNames in assignment order and overrides roleId/roleName with the live PRIMARY role', async () => {
      users.findAuthState.mockResolvedValue(liveState([OPERATIONS, SUPER_ADMIN]));

      const principal = await strategy.validate(staffToken());

      expect(principal).toMatchObject({
        sub: 7,
        email: 'staff@ccb.local',
        type: 'staff',
        iat: 1_700_000_000,
        exp: 1_900_000_000,
        roleId: OPERATIONS.id,
        roleName: 'OPERATIONS',
        roleIds: [OPERATIONS.id, SUPER_ADMIN.id],
        roleNames: ['OPERATIONS', 'SUPER_ADMIN'],
      });
    });

    it('token claims that differ from the live roles never leak: a stale SUPER_ADMIN claim yields no SUPER_ADMIN on the principal', async () => {
      users.findAuthState.mockResolvedValue(liveState([FINANCE]));

      const principal = await strategy.validate(staffToken({ roleId: SUPER_ADMIN.id, roleName: 'SUPER_ADMIN' }));

      expect(principal).toMatchObject({ roleId: FINANCE.id, roleName: 'FINANCE', roleIds: [FINANCE.id], roleNames: ['FINANCE'] });
      expect((principal as { roleNames: string[] }).roleNames).not.toContain('SUPER_ADMIN');
    });

    it('role-set claims smuggled into the token itself are overwritten by the live set too — they can never survive validation', async () => {
      users.findAuthState.mockResolvedValue(liveState([FINANCE]));

      const principal = await strategy.validate(staffToken({ roleIds: [SUPER_ADMIN.id], roleNames: ['SUPER_ADMIN'] }));

      expect(principal).toMatchObject({ roleIds: [FINANCE.id], roleNames: ['FINANCE'] });
    });

    it('a mustChangePassword claim smuggled into the token is overwritten by the live flag — a token cannot clear the requirement', async () => {
      users.findAuthState.mockResolvedValue(liveState([FINANCE], { mustChangePassword: true }));

      const principal = await strategy.validate(staffToken({ mustChangePassword: false }));

      expect(principal).toMatchObject({ mustChangePassword: true });
    });

    it('a role the user ONLY gained after the token was issued is on the principal at once', async () => {
      users.findAuthState.mockResolvedValue(liveState([FINANCE, SUPER_ADMIN]));

      const principal = await strategy.validate(staffToken()); // token knows only FINANCE

      expect(principal).toMatchObject({ roleIds: [FINANCE.id, SUPER_ADMIN.id], roleNames: ['FINANCE', 'SUPER_ADMIN'] });
    });

    it('a single live role still yields one-element roleIds/roleNames', async () => {
      users.findAuthState.mockResolvedValue(liveState([FINANCE]));

      const principal = await strategy.validate(staffToken());

      expect(principal).toMatchObject({ roleId: 3, roleName: 'FINANCE', roleIds: [3], roleNames: ['FINANCE'] });
    });

    it('REVOCATION: the SAME token is re-evaluated against the database on every request — revoke a role and the very next request no longer carries it', async () => {
      const token = staffToken(); // one token, reused for every request below

      users.findAuthState.mockResolvedValueOnce(liveState([FINANCE, OPERATIONS]));
      const before = await strategy.validate(token);
      expect(before).toMatchObject({ roleId: 3, roleIds: [3, 4], roleNames: ['FINANCE', 'OPERATIONS'] });

      // FINANCE (the token's own primary role) is revoked between the two requests.
      users.findAuthState.mockResolvedValueOnce(liveState([OPERATIONS]));
      const after = await strategy.validate(token);

      expect(after).toMatchObject({ roleId: 4, roleName: 'OPERATIONS', roleIds: [4], roleNames: ['OPERATIONS'] });
      expect((after as { roleIds: number[] }).roleIds).not.toContain(FINANCE.id);
      expect(users.findAuthState).toHaveBeenCalledTimes(2); // no caching between requests
    });

    it('a role-less user is locked out on the very next request: after the LAST role is revoked the same token is rejected', async () => {
      const token = staffToken();

      users.findAuthState.mockResolvedValueOnce(liveState([FINANCE]));
      await expect(strategy.validate(token)).resolves.toBeDefined();

      users.findAuthState.mockResolvedValueOnce(liveState([]));
      await expect(strategy.validate(token)).rejects.toThrow(new UnauthorizedException('No role assigned'));
    });

    it('resolves the live state from the single UserService.findAuthState call — no additional lookup — and leaves the token payload itself unmutated', async () => {
      users.findAuthState.mockResolvedValue(liveState([OPERATIONS]));
      const payload = staffToken() as { roleId: number; roleName: string; roleIds?: number[] };

      await strategy.validate(payload as never);

      expect(users.findAuthState).toHaveBeenCalledTimes(1);
      expect(users.findAuthState).toHaveBeenCalledWith(7);
      expect(users.findOne).not.toHaveBeenCalled(); // the heavy, relation-loading lookup is not on the hot path
      expect(customers.findOne).not.toHaveBeenCalled();
      expect(payload.roleId).toBe(FINANCE.id); // the original claim object is untouched
      expect(payload.roleIds).toBeUndefined();
    });
  });

  describe('staff — mandatory password change is visible on every request', () => {
    it('carries mustChangePassword=true while a change is still required, and false once it is not', async () => {
      users.findAuthState.mockResolvedValueOnce(liveState([FINANCE], { mustChangePassword: true }));
      await expect(strategy.validate(staffToken())).resolves.toMatchObject({ mustChangePassword: true });

      users.findAuthState.mockResolvedValueOnce(liveState([FINANCE], { mustChangePassword: false }));
      await expect(strategy.validate(staffToken())).resolves.toMatchObject({ mustChangePassword: false });
    });

    it('still authenticates a user who must change their password — the PasswordChangeGuard, not this strategy, restricts what they can reach', async () => {
      users.findAuthState.mockResolvedValue(liveState([FINANCE], { mustChangePassword: true }));

      await expect(strategy.validate(staffToken())).resolves.toBeDefined();
    });
  });

  describe('staff — rejections', () => {
    it('zero live roles is rejected with 401 "No role assigned"', async () => {
      users.findAuthState.mockResolvedValue(liveState([]));

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('No role assigned'));
    });

    it('an inactive user is still rejected ("Account is deactivated"), whatever roles they hold', async () => {
      users.findAuthState.mockResolvedValue(liveState([FINANCE, SUPER_ADMIN], { active: false }));

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('Account is deactivated'));
    });

    it('the deactivated check wins over the no-role check', async () => {
      users.findAuthState.mockResolvedValue(liveState([], { active: false }));

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('Account is deactivated'));
    });

    it('a user that no longer exists is rejected ("User not found")', async () => {
      users.findAuthState.mockRejectedValue(new NotFoundException('User not found'));

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('User not found'));
    });

    it('any other failure while loading the user is a 401, never a principal', async () => {
      users.findAuthState.mockRejectedValue(new Error('connection lost'));

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('User not found'));
    });

    it.each([
      ['sub', { sub: undefined }],
      ['email', { email: undefined }],
    ])('a token without %s is an invalid payload and never reaches the database', async (_field, overrides) => {
      await expect(strategy.validate(staffToken(overrides))).rejects.toThrow(new UnauthorizedException('Invalid token payload'));
      expect(users.findAuthState).not.toHaveBeenCalled();
    });

    it("a staff token without a roleName claim is still a malformed payload (shape check only — the claim's value is never used)", async () => {
      await expect(strategy.validate(staffToken({ roleName: undefined }))).rejects.toThrow(new UnauthorizedException('Invalid token payload'));
      expect(users.findAuthState).not.toHaveBeenCalled();
    });
  });

  describe('customer — unchanged', () => {
    const customerToken = (overrides: Record<string, unknown> = {}) =>
      ({ sub: 9, email: 'resident@example.com', type: 'customer', ...overrides }) as never;

    it('returns the token payload as-is for an active customer, resolves no roles, and never touches the User table', async () => {
      customers.findOne.mockResolvedValue({ id: 9, accountStatus: CustomerAccountStatus.ACTIVE });
      const payload = customerToken();

      const principal = await strategy.validate(payload);

      expect(principal).toBe(payload);
      expect(principal).not.toHaveProperty('roleIds');
      expect(principal).not.toHaveProperty('roleNames');
      expect(customers.findOne).toHaveBeenCalledWith(9);
      expect(users.findAuthState).not.toHaveBeenCalled();
    });

    it('a customer token that carries staff-looking role claims gains no live roles from them', async () => {
      customers.findOne.mockResolvedValue({ id: 9, accountStatus: CustomerAccountStatus.ACTIVE });
      const payload = customerToken({ roleId: 1, roleName: 'SUPER_ADMIN' });

      const principal = await strategy.validate(payload);

      expect(principal).toBe(payload);
      expect(principal).not.toHaveProperty('roleIds');
      expect(users.findAuthState).not.toHaveBeenCalled();
    });

    it('an INACTIVE (deposit-pending) customer is still let through — only OVERDUE is refused', async () => {
      customers.findOne.mockResolvedValue({ id: 9, accountStatus: CustomerAccountStatus.INACTIVE });

      await expect(strategy.validate(customerToken())).resolves.toBeDefined();
    });

    it('an OVERDUE customer is rejected ("Account is not active")', async () => {
      customers.findOne.mockResolvedValue({ id: 9, accountStatus: CustomerAccountStatus.OVERDUE });

      await expect(strategy.validate(customerToken())).rejects.toThrow(new UnauthorizedException('Account is not active'));
    });

    it('a customer that no longer exists is rejected ("Customer not found")', async () => {
      customers.findOne.mockRejectedValue(new NotFoundException('Customer not found'));

      await expect(strategy.validate(customerToken())).rejects.toThrow(new UnauthorizedException('Customer not found'));
    });
  });
});

// SESSION BINDING: a token that carries `sid` is honoured only while its session (the refresh-token family it was issued
// for) is still live; a token without `sid` is not checked. Every dependency is stubbed.
describe('JwtStrategy.validate — session binding', () => {
  let users: { findAuthState: jest.Mock };
  let customers: { findOne: jest.Mock };
  let sessions: { isLive: jest.Mock };
  let strategy: JwtStrategy;

  const staffToken = (overrides: Record<string, unknown> = {}) =>
    ({ sub: 7, email: 'staff@ccb.local', roleId: 3, roleName: 'FINANCE', type: 'staff', iat: 1_700_000_000, exp: 1_900_000_000, ...overrides }) as never;
  const customerToken = (overrides: Record<string, unknown> = {}) =>
    ({ sub: 9, email: 'owner@example.com', type: 'customer', iat: 1_700_000_000, exp: 1_900_000_000, ...overrides }) as never;

  beforeEach(() => {
    users = {
      findAuthState: jest.fn().mockResolvedValue({ id: 7, active: true, mustChangePassword: false, roles: [{ id: 3, roleName: 'FINANCE' }] }),
    };
    customers = { findOne: jest.fn().mockResolvedValue({ id: 9, accountStatus: CustomerAccountStatus.ACTIVE }) };
    sessions = { isLive: jest.fn() };
    const config = { getOrThrow: jest.fn().mockReturnValue('test-secret-test-secret-test-secret') };
    strategy = new JwtStrategy(config as never, users as never, customers as never, sessions as never);
  });

  it('a staff token whose session is live is accepted, and the session is asked about the staff principal', async () => {
    sessions.isLive.mockResolvedValue(true);

    await expect(strategy.validate(staffToken({ sid: 'family-1' }))).resolves.toBeDefined();
    expect(sessions.isLive).toHaveBeenCalledWith('staff', 7, 'family-1');
  });

  it('a staff token whose session has ended is rejected ("Session is no longer active") before the user is even re-read', async () => {
    sessions.isLive.mockResolvedValue(false);

    await expect(strategy.validate(staffToken({ sid: 'family-1' }))).rejects.toThrow(new UnauthorizedException('Session is no longer active'));
    expect(users.findAuthState).not.toHaveBeenCalled();
  });

  it('a customer token is checked against the CUSTOMER session space, never the staff one', async () => {
    sessions.isLive.mockResolvedValue(true);

    await expect(strategy.validate(customerToken({ sid: 'family-9' }))).resolves.toBeDefined();
    expect(sessions.isLive).toHaveBeenCalledWith('customer', 9, 'family-9');
  });

  it('a token without `sid` (issued before session binding existed) is not session-checked', async () => {
    await expect(strategy.validate(staffToken())).resolves.toBeDefined();
    expect(sessions.isLive).not.toHaveBeenCalled();
  });

  it('a token with an empty or non-string `sid` is rejected rather than treated as "no session"', async () => {
    await expect(strategy.validate(staffToken({ sid: '' }))).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(staffToken({ sid: 123 }))).rejects.toThrow(UnauthorizedException);
    expect(sessions.isLive).not.toHaveBeenCalled();
  });
});

// The signature/expiry/algorithm checks happen in passport-jwt BEFORE validate() runs, driven by the options
// JwtStrategy hands it. These tests run a real signed token through that exact verification (jsonwebtoken's
// verify with the strategy's own options) so a wrong secret, an expired token, a tampered token and an
// algorithm-confusion token are proven to be rejected — validate() is never reached for any of them.
describe('JwtStrategy token verification options — invalid, expired and wrong-secret tokens are rejected', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
  const SECRET = 'a-test-secret-that-is-long-enough-for-hs256-0123456789';
  const OTHER_SECRET = 'a-different-secret-that-is-also-long-enough-9876543210';
  const payload = { sub: 7, email: 'staff@ccb.local', roleId: 3, roleName: 'FINANCE', type: 'staff' };

  /** The options JwtStrategy passes to passport-jwt, captured by constructing it with the real config. */
  function strategyOptions() {
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };
    const strategy = new JwtStrategy(config as never, {} as never, {} as never, {} as never) as unknown as {
      _secretOrKeyProvider: (req: unknown, token: string, done: (err: unknown, secret?: string) => void) => void;
      _verifOpts: { algorithms?: string[]; ignoreExpiration?: boolean };
    };
    return strategy;
  }

  const verifyWithStrategyOptions = (token: string) => {
    const strategy = strategyOptions();
    const options = strategy._verifOpts;
    return jwt.verify(token, SECRET, { algorithms: options.algorithms as import('jsonwebtoken').Algorithm[], ignoreExpiration: options.ignoreExpiration });
  };

  it('pins the algorithm to HS256 and never ignores expiry', () => {
    const options = strategyOptions()._verifOpts;

    expect(options.algorithms).toEqual(['HS256']);
    expect(options.ignoreExpiration).toBe(false);
  });

  it('accepts a correctly signed, unexpired HS256 token', () => {
    const token = jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '5m' });

    expect(verifyWithStrategyOptions(token)).toMatchObject({ sub: 7, email: 'staff@ccb.local' });
  });

  it('rejects a token signed with the WRONG secret (for example another environment\'s)', () => {
    const token = jwt.sign(payload, OTHER_SECRET, { algorithm: 'HS256', expiresIn: '5m' });

    expect(() => verifyWithStrategyOptions(token)).toThrow(/invalid signature/);
  });

  it('rejects an EXPIRED token', () => {
    const token = jwt.sign({ ...payload, iat: Math.floor(Date.now() / 1000) - 3600 }, SECRET, { algorithm: 'HS256', expiresIn: 60 });

    expect(() => verifyWithStrategyOptions(token)).toThrow(/jwt expired/);
  });

  it('rejects a TAMPERED token (payload edited after signing, e.g. role escalation)', () => {
    const token = jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...payload, roleName: 'SUPER_ADMIN', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');

    expect(() => verifyWithStrategyOptions(`${header}.${forgedPayload}.${signature}`)).toThrow(/invalid signature/);
  });

  it('rejects an unsigned (alg: none) token — the classic algorithm-confusion attack', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');

    expect(() => verifyWithStrategyOptions(`${header}.${body}.`)).toThrow();
  });

  it('rejects a token signed with a DIFFERENT HMAC algorithm (HS512) even with the right secret — only the pinned HS256 is accepted', () => {
    const token = jwt.sign(payload, SECRET, { algorithm: 'HS512', expiresIn: '5m' });

    expect(() => verifyWithStrategyOptions(token)).toThrow(/invalid algorithm/);
  });

  it('rejects a malformed token string', () => {
    expect(() => verifyWithStrategyOptions('not.a.jwt')).toThrow();
    expect(() => verifyWithStrategyOptions('')).toThrow();
  });

  it('is not satisfied by JwtService defaults either: a token minted by a JwtService with another secret is refused', () => {
    const other = new JwtService({ secret: OTHER_SECRET });
    const token = other.sign(payload, { expiresIn: '5m' });

    expect(() => verifyWithStrategyOptions(token)).toThrow(/invalid signature/);
  });
});
