import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { CustomerAccountStatus } from '../../modules/customer/entities/customer.entity';

// Isolated tests for JwtStrategy.validate's STALE-CLAIM rule: authorization must never trust role
// claims inside the JWT. For a staff token the strategy re-reads the user (and so their CURRENT roles)
// from the database on every request and attaches the live role set to the request principal as
// roleIds/roleNames — assignment order, index 0 = primary — overriding the token's singular
// roleId/roleName with the live primary. A role revoked or granted after the token was issued
// therefore takes effect on the very next request made with the SAME token, and a user left with no
// role is rejected outright. Every dependency is stubbed; no real database connection.
describe('JwtStrategy.validate — live roles, never token claims', () => {
  let users: { findOne: jest.Mock };
  let customers: { findOne: jest.Mock };
  let strategy: JwtStrategy;

  const SUPER_ADMIN = { id: 1, roleName: 'SUPER_ADMIN' };
  const FINANCE = { id: 3, roleName: 'FINANCE' };
  const OPERATIONS = { id: 4, roleName: 'OPERATIONS' };

  beforeEach(() => {
    users = { findOne: jest.fn() };
    customers = { findOne: jest.fn() };
    const config = { getOrThrow: jest.fn().mockReturnValue('test-secret') };
    strategy = new JwtStrategy(config as never, users as never, customers as never);
  });

  /** A signed staff token's payload — roleId/roleName are the primary role AT ISSUE TIME. */
  const staffToken = (overrides: Record<string, unknown> = {}) =>
    ({ sub: 7, email: 'staff@ccb.local', roleId: FINANCE.id, roleName: FINANCE.roleName, type: 'staff', iat: 1_700_000_000, exp: 1_900_000_000, ...overrides }) as never;

  /** What UserService.findOne returns: the user plus `role` (primary) and `roles` (all, in order). */
  const liveUser = (roles: { id: number; roleName: string }[], overrides: Record<string, unknown> = {}) => ({
    id: 7,
    active: true,
    role: roles[0] ?? null,
    roles,
    ...overrides,
  });

  describe('staff — the live role set replaces whatever the token claimed', () => {
    it('attaches roleIds/roleNames in assignment order and overrides roleId/roleName with the live PRIMARY role', async () => {
      users.findOne.mockResolvedValue(liveUser([OPERATIONS, SUPER_ADMIN]));

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
      users.findOne.mockResolvedValue(liveUser([FINANCE]));

      const principal = await strategy.validate(staffToken({ roleId: SUPER_ADMIN.id, roleName: 'SUPER_ADMIN' }));

      expect(principal).toMatchObject({ roleId: FINANCE.id, roleName: 'FINANCE', roleIds: [FINANCE.id], roleNames: ['FINANCE'] });
      expect((principal as { roleNames: string[] }).roleNames).not.toContain('SUPER_ADMIN');
    });

    it('role-set claims smuggled into the token itself are overwritten by the live set too — they can never survive validation', async () => {
      users.findOne.mockResolvedValue(liveUser([FINANCE]));

      const principal = await strategy.validate(staffToken({ roleIds: [SUPER_ADMIN.id], roleNames: ['SUPER_ADMIN'] }));

      expect(principal).toMatchObject({ roleIds: [FINANCE.id], roleNames: ['FINANCE'] });
    });

    it('a role the user ONLY gained after the token was issued is on the principal at once', async () => {
      users.findOne.mockResolvedValue(liveUser([FINANCE, SUPER_ADMIN]));

      const principal = await strategy.validate(staffToken()); // token knows only FINANCE

      expect(principal).toMatchObject({ roleIds: [FINANCE.id, SUPER_ADMIN.id], roleNames: ['FINANCE', 'SUPER_ADMIN'] });
    });

    it('a single live role still yields one-element roleIds/roleNames', async () => {
      users.findOne.mockResolvedValue(liveUser([FINANCE]));

      const principal = await strategy.validate(staffToken());

      expect(principal).toMatchObject({ roleId: 3, roleName: 'FINANCE', roleIds: [3], roleNames: ['FINANCE'] });
    });

    it('REVOCATION: the SAME token is re-evaluated against the database on every request — revoke a role and the very next request no longer carries it', async () => {
      const token = staffToken(); // one token, reused for every request below

      users.findOne.mockResolvedValueOnce(liveUser([FINANCE, OPERATIONS]));
      const before = await strategy.validate(token);
      expect(before).toMatchObject({ roleId: 3, roleIds: [3, 4], roleNames: ['FINANCE', 'OPERATIONS'] });

      // FINANCE (the token's own primary role) is revoked between the two requests.
      users.findOne.mockResolvedValueOnce(liveUser([OPERATIONS]));
      const after = await strategy.validate(token);

      expect(after).toMatchObject({ roleId: 4, roleName: 'OPERATIONS', roleIds: [4], roleNames: ['OPERATIONS'] });
      expect((after as { roleIds: number[] }).roleIds).not.toContain(FINANCE.id);
      expect(users.findOne).toHaveBeenCalledTimes(2); // no caching between requests
    });

    it('a role-less user is locked out on the very next request: after the LAST role is revoked the same token is rejected', async () => {
      const token = staffToken();

      users.findOne.mockResolvedValueOnce(liveUser([FINANCE]));
      await expect(strategy.validate(token)).resolves.toBeDefined();

      users.findOne.mockResolvedValueOnce(liveUser([]));
      await expect(strategy.validate(token)).rejects.toThrow(new UnauthorizedException('No role assigned'));
    });

    it('resolves the live roles from the single UserService.findOne call — no additional lookup — and leaves the token payload itself unmutated', async () => {
      users.findOne.mockResolvedValue(liveUser([OPERATIONS]));
      const payload = staffToken() as { roleId: number; roleName: string; roleIds?: number[] };

      await strategy.validate(payload as never);

      expect(users.findOne).toHaveBeenCalledTimes(1);
      expect(users.findOne).toHaveBeenCalledWith(7);
      expect(customers.findOne).not.toHaveBeenCalled();
      expect(payload.roleId).toBe(FINANCE.id); // the original claim object is untouched
      expect(payload.roleIds).toBeUndefined();
    });
  });

  describe('staff — rejections', () => {
    it('zero live roles is rejected with 401 "No role assigned"', async () => {
      users.findOne.mockResolvedValue(liveUser([]));

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('No role assigned'));
    });

    it('a findOne result with neither roles nor role is rejected the same way', async () => {
      users.findOne.mockResolvedValue({ id: 7, active: true });

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('No role assigned'));
    });

    it('an inactive user is still rejected ("Account is deactivated"), whatever roles they hold', async () => {
      users.findOne.mockResolvedValue(liveUser([FINANCE, SUPER_ADMIN], { active: false }));

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('Account is deactivated'));
    });

    it('the deactivated check wins over the no-role check', async () => {
      users.findOne.mockResolvedValue(liveUser([], { active: false }));

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('Account is deactivated'));
    });

    it('a user that no longer exists is rejected ("User not found")', async () => {
      users.findOne.mockRejectedValue(new NotFoundException('User not found'));

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('User not found'));
    });

    it('any other failure while loading the user is a 401, never a principal', async () => {
      users.findOne.mockRejectedValue(new Error('connection lost'));

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('User not found'));
    });

    it.each([
      ['sub', { sub: undefined }],
      ['email', { email: undefined }],
    ])('a token without %s is an invalid payload and never reaches the database', async (_field, overrides) => {
      await expect(strategy.validate(staffToken(overrides))).rejects.toThrow(new UnauthorizedException('Invalid token payload'));
      expect(users.findOne).not.toHaveBeenCalled();
    });

    it('a staff token without a roleName claim is still a malformed payload (shape check only — the claim\'s value is never used)', async () => {
      await expect(strategy.validate(staffToken({ roleName: undefined }))).rejects.toThrow(new UnauthorizedException('Invalid token payload'));
      expect(users.findOne).not.toHaveBeenCalled();
    });
  });

  describe('staff — a findOne result that has not got `roles` yet (older shape)', () => {
    it('falls back to [role]: the primary only, never more', async () => {
      users.findOne.mockResolvedValue({ id: 7, active: true, role: OPERATIONS });

      const principal = await strategy.validate(staffToken());

      expect(principal).toMatchObject({ roleId: 4, roleName: 'OPERATIONS', roleIds: [4], roleNames: ['OPERATIONS'] });
    });

    it('a present-but-empty `roles` is authoritative — it fails closed rather than falling back to `role`', async () => {
      users.findOne.mockResolvedValue({ id: 7, active: true, role: FINANCE, roles: [] });

      await expect(strategy.validate(staffToken())).rejects.toThrow(new UnauthorizedException('No role assigned'));
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
      expect(users.findOne).not.toHaveBeenCalled();
    });

    it('a customer token that carries staff-looking role claims gains no live roles from them', async () => {
      customers.findOne.mockResolvedValue({ id: 9, accountStatus: CustomerAccountStatus.ACTIVE });
      const payload = customerToken({ roleId: 1, roleName: 'SUPER_ADMIN' });

      const principal = await strategy.validate(payload);

      expect(principal).toBe(payload);
      expect(principal).not.toHaveProperty('roleIds');
      expect(users.findOne).not.toHaveBeenCalled();
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
