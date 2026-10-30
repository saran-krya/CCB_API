import * as bcrypt from 'bcryptjs';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { IamService } from '../modules/iam/iam.service';
import { RolePermissionsService } from '../modules/role-permissions/role-permissions.service';

// End-to-end proof of the STALE-CLAIM rule across the REAL pieces that make up one request's
// authorization: JwtStrategy (re-reads the user's roles on every request), the real PermissionGuard and
// RolesGuard, the real RolePermissionsService and the real IamService. Only the database is replaced —
// a mutable in-memory user_roles table and role_policies rows — so a test can revoke or grant a role
// BETWEEN two requests that present the very same token, which is exactly the case the rule exists for.
// Authorization must follow the live user_roles rows, never the role claims baked into the token.
class ProbeController {
  @Permission('APPROVE_TARIFF')
  approveTariff() {}

  @Permission('VIEW_METER', 'EDIT_METER')
  meters() {}

  @Roles('SUPER_ADMIN')
  rootOnly() {}
}

type Role = { id: number; roleName: string };
const SUPER_ADMIN: Role = { id: 1, roleName: 'SUPER_ADMIN' };
const FINANCE: Role = { id: 3, roleName: 'FINANCE' };
const OPERATIONS: Role = { id: 4, roleName: 'OPERATIONS' };
const AUDITOR: Role = { id: 6, roleName: 'AUDITOR' }; // no Policies attached at all

const USER_ID = 7;

describe('Live role authorization — the same token, re-evaluated against current user_roles on every request', () => {
  let userRoles: Map<number, Role[]>; // userId -> CURRENT roles in assignment order (user_roles.id ASC)
  let rolePolicyFind: jest.Mock;
  let inlinePolicies: Map<number, { statements: { effect: string; actions: string[] }[] }[]>; // userId -> that user's inline policies
  let inlinePolicyFind: jest.Mock;
  let rolePermissions: RolePermissionsService;
  let strategy: JwtStrategy;
  let permissionGuard: PermissionGuard;
  let rolesGuard: RolesGuard;
  let controller: AuthController;

  // role_policies rows — what each role's attached Policies grant.
  const ROLE_POLICY_ROWS = [
    { roleId: FINANCE.id, policy: { statements: [{ effect: 'Allow', actions: ['APPROVE_TARIFF'] }] } },
    { roleId: OPERATIONS.id, policy: { statements: [{ effect: 'Allow', actions: ['VIEW_METER', 'EDIT_METER'] }] } },
    { roleId: SUPER_ADMIN.id, policy: { statements: [{ effect: 'Allow', actions: ['APPROVE_TARIFF', 'VIEW_METER', 'EDIT_METER'] }] } },
  ];

  /** The token the user was issued at login: signed with whatever their PRIMARY role was THEN. */
  const tokenIssuedAs = (role: Role) =>
    ({ sub: USER_ID, email: 'staff@ccb.local', roleId: role.id, roleName: role.roleName, type: 'staff', iat: 1_700_000_000, exp: 1_900_000_000 }) as never;

  beforeEach(() => {
    userRoles = new Map([[USER_ID, [FINANCE]]]);
    inlinePolicies = new Map();

    const legacyTable = new Proxy(
      {},
      {
        get() {
          throw new Error('role_permissions must never be read for authorization');
        },
      },
    );
    rolePolicyFind = jest.fn(({ where }: { where: { roleId: { value: number[] } } }) =>
      Promise.resolve(ROLE_POLICY_ROWS.filter((row) => where.roleId.value.includes(row.roleId))),
    );
    inlinePolicyFind = jest.fn(({ where }: { where: { userId: number } }) =>
      Promise.resolve((inlinePolicies.get(where.userId) ?? []).map((policy) => ({ userId: where.userId, ...policy }))),
    );
    const iam = new IamService(
      {} as never, {} as never, {} as never, { find: rolePolicyFind } as never, {} as never, {} as never, {} as never, {} as never,
      { find: inlinePolicyFind } as never,
      // This spec never exercises a role's OWN inline policies — only the user's — so an always-empty
      // mock preserves every existing assertion in this file exactly.
      { find: () => Promise.resolve([]) } as never,
    );
    rolePermissions = new RolePermissionsService(legacyTable as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, iam);

    // UserService.findOne's shape: the user plus `role` (primary) and `roles` (all, in order), re-read each call.
    const users = {
      findOne: jest.fn(async (id: number) => {
        const roles = userRoles.get(id);
        if (!roles) throw new NotFoundException('User not found');
        return { id, active: true, role: roles[0] ?? null, roles: [...roles] };
      }),
    };
    strategy = new JwtStrategy({ getOrThrow: () => 'test-secret' } as never, users as never, {} as never);
    permissionGuard = new PermissionGuard(new Reflector(), rolePermissions);
    rolesGuard = new RolesGuard(new Reflector());
    controller = new AuthController({} as never, {} as never, rolePermissions);
  });

  /** One request: JwtStrategy.validate builds the principal (and may reject the request outright). */
  const contextFor = (handler: keyof ProbeController, principal: unknown) =>
    ({
      getHandler: () => ProbeController.prototype[handler],
      getClass: () => ProbeController,
      switchToHttp: () => ({ getRequest: () => ({ user: principal }) }),
    }) as unknown as ExecutionContext;

  async function permitted(token: never, handler: keyof ProbeController): Promise<boolean> {
    const principal = await strategy.validate(token);
    return permissionGuard.canActivate(contextFor(handler, principal));
  }

  async function roleAllowed(token: never, handler: keyof ProbeController): Promise<boolean> {
    const principal = await strategy.validate(token);
    return rolesGuard.canActivate(contextFor(handler, principal));
  }

  async function myActions(token: never): Promise<string[]> {
    const principal = (await strategy.validate(token)) as AuthenticatedUser;
    return (await controller.getMyActionCodes(principal)).actionCodes.sort();
  }

  describe('@Permission routes', () => {
    it('REVOCATION: revoking the role that granted the permission takes effect on the very next request with the SAME token', async () => {
      const token = tokenIssuedAs(FINANCE);

      expect(await permitted(token, 'approveTariff')).toBe(true);

      userRoles.set(USER_ID, [OPERATIONS]); // FINANCE revoked, OPERATIONS granted — the token still says FINANCE

      expect(await permitted(token, 'approveTariff')).toBe(false);
      expect(await permitted(token, 'meters')).toBe(true); // ...and the newly granted role already counts
    });

    it('a permission granted only by a SECONDARY role is honoured; the token\'s own (primary) role is not special', async () => {
      userRoles.set(USER_ID, [AUDITOR, OPERATIONS]); // primary AUDITOR grants nothing, secondary OPERATIONS grants meters
      const token = tokenIssuedAs(AUDITOR);

      expect(await permitted(token, 'meters')).toBe(true);
      expect(await permitted(token, 'approveTariff')).toBe(false);
    });

    it('union across roles: permissions from every live role apply together', async () => {
      userRoles.set(USER_ID, [FINANCE, OPERATIONS]);
      const token = tokenIssuedAs(FINANCE);

      expect(await permitted(token, 'approveTariff')).toBe(true); // via FINANCE
      expect(await permitted(token, 'meters')).toBe(true); // via OPERATIONS
    });

    it('a role that grants nothing never removes another role\'s grant', async () => {
      userRoles.set(USER_ID, [AUDITOR, FINANCE]);

      expect(await permitted(tokenIssuedAs(AUDITOR), 'approveTariff')).toBe(true);
    });

    it('a role added AFTER the token was issued grants its permissions on the very next request', async () => {
      const token = tokenIssuedAs(FINANCE);
      expect(await permitted(token, 'meters')).toBe(false);

      userRoles.set(USER_ID, [FINANCE, OPERATIONS]);

      expect(await permitted(token, 'meters')).toBe(true);
    });

    it('revoking the LAST role rejects the same token outright (401), so not even routes without any @Permission are reachable', async () => {
      const token = tokenIssuedAs(FINANCE);
      expect(await permitted(token, 'approveTariff')).toBe(true);

      userRoles.set(USER_ID, []);

      await expect(strategy.validate(token)).rejects.toThrow(new UnauthorizedException('No role assigned'));
      await expect(permitted(token, 'approveTariff')).rejects.toThrow(UnauthorizedException);
    });

    it('nothing is cached: flipping a role back and forth between requests flips the decision every time', async () => {
      const token = tokenIssuedAs(FINANCE);

      for (const [roles, expected] of [
        [[FINANCE], true],
        [[AUDITOR], false],
        [[FINANCE], true],
        [[AUDITOR, FINANCE], true],
        [[AUDITOR], false],
      ] as [Role[], boolean][]) {
        userRoles.set(USER_ID, roles);
        expect(await permitted(token, 'approveTariff')).toBe(expected);
      }
    });
  });

  describe('@Roles routes', () => {
    it('SUPER_ADMIN held as a SECONDARY role satisfies a SUPER_ADMIN-only route', async () => {
      userRoles.set(USER_ID, [FINANCE, SUPER_ADMIN]);

      expect(await roleAllowed(tokenIssuedAs(FINANCE), 'rootOnly')).toBe(true);
    });

    it('a stale SUPER_ADMIN claim grants nothing once the role was revoked: the SAME token passes, then fails', async () => {
      userRoles.set(USER_ID, [SUPER_ADMIN]);
      const token = tokenIssuedAs(SUPER_ADMIN);
      expect(await roleAllowed(token, 'rootOnly')).toBe(true);

      userRoles.set(USER_ID, [FINANCE]); // demoted; the token still claims SUPER_ADMIN

      expect(await roleAllowed(token, 'rootOnly')).toBe(false);
    });

    it('a SUPER_ADMIN role granted after the token was issued takes effect on the next request', async () => {
      const token = tokenIssuedAs(FINANCE);
      expect(await roleAllowed(token, 'rootOnly')).toBe(false);

      userRoles.set(USER_ID, [FINANCE, SUPER_ADMIN]);

      expect(await roleAllowed(token, 'rootOnly')).toBe(true);
    });
  });

  describe('GET /auth/me/actions', () => {
    it('is the UNION of the permissions granted by every live role', async () => {
      userRoles.set(USER_ID, [FINANCE, OPERATIONS, AUDITOR]);

      expect(await myActions(tokenIssuedAs(FINANCE))).toEqual(['APPROVE_TARIFF', 'EDIT_METER', 'VIEW_METER']);
    });

    it('follows revocation with the same token: it stops listing what a revoked role granted', async () => {
      const token = tokenIssuedAs(FINANCE);
      userRoles.set(USER_ID, [FINANCE, OPERATIONS]);
      expect(await myActions(token)).toEqual(['APPROVE_TARIFF', 'EDIT_METER', 'VIEW_METER']);

      userRoles.set(USER_ID, [OPERATIONS]);

      expect(await myActions(token)).toEqual(['EDIT_METER', 'VIEW_METER']);
    });

    it('lists exactly what PermissionGuard would allow — the two never disagree', async () => {
      userRoles.set(USER_ID, [AUDITOR, OPERATIONS]);
      const token = tokenIssuedAs(AUDITOR);
      const actions = await myActions(token);

      expect(actions).toContain('VIEW_METER');
      expect(actions).not.toContain('APPROVE_TARIFF');
      expect(await permitted(token, 'meters')).toBe(true);
      expect(await permitted(token, 'approveTariff')).toBe(false);
    });
  });

  describe("the user's own INLINE policies (user-level grants, resolved live like roles)", () => {
    const grantInline = (userId: number, ...actions: string[]) => {
      const rows = inlinePolicies.get(userId) ?? [];
      inlinePolicies.set(userId, [...rows, { statements: [{ effect: 'Allow', actions }] }]);
    };

    it('GRANT: an inline policy grants a permission NO role grants — on the very next request with the SAME token', async () => {
      userRoles.set(USER_ID, [OPERATIONS]); // OPERATIONS grants meters only
      const token = tokenIssuedAs(OPERATIONS);
      expect(await permitted(token, 'approveTariff')).toBe(false);

      grantInline(USER_ID, 'APPROVE_TARIFF');

      expect(await permitted(token, 'approveTariff')).toBe(true);
      expect(await permitted(token, 'meters')).toBe(true); // the role's own grants are untouched
    });

    it('REVOCATION: deleting the inline policy stops the grant on the very next request with the SAME token', async () => {
      userRoles.set(USER_ID, [OPERATIONS]);
      const token = tokenIssuedAs(OPERATIONS);
      grantInline(USER_ID, 'APPROVE_TARIFF');
      expect(await permitted(token, 'approveTariff')).toBe(true);

      inlinePolicies.delete(USER_ID); // the policy is deleted

      expect(await permitted(token, 'approveTariff')).toBe(false);
      expect(await permitted(token, 'meters')).toBe(true); // ...and nothing else changed
    });

    it("is ADDITIVE: it never removes a role's grant, and a role never removes the inline grant", async () => {
      userRoles.set(USER_ID, [FINANCE]);
      grantInline(USER_ID, 'VIEW_METER');
      const token = tokenIssuedAs(FINANCE);

      expect(await permitted(token, 'approveTariff')).toBe(true); // role grant
      expect(await permitted(token, 'meters')).toBe(true); // inline grant (VIEW_METER satisfies the route)

      userRoles.set(USER_ID, [AUDITOR]); // the granting role is revoked — the inline grant stays
      expect(await permitted(token, 'approveTariff')).toBe(false);
      expect(await permitted(token, 'meters')).toBe(true);
    });

    it("another user's inline policy never applies to this user", async () => {
      userRoles.set(USER_ID, [AUDITOR]);
      grantInline(USER_ID + 1, 'APPROVE_TARIFF');

      expect(await permitted(tokenIssuedAs(AUDITOR), 'approveTariff')).toBe(false);
    });

    it('GET /auth/me/actions includes the inline grants (so the sidebar matches what the guard enforces) and follows revocation', async () => {
      userRoles.set(USER_ID, [OPERATIONS]);
      const token = tokenIssuedAs(OPERATIONS);
      grantInline(USER_ID, 'APPROVE_TARIFF');

      expect(await myActions(token)).toEqual(['APPROVE_TARIFF', 'EDIT_METER', 'VIEW_METER']);

      inlinePolicies.delete(USER_ID);

      expect(await myActions(token)).toEqual(['EDIT_METER', 'VIEW_METER']);
    });

    it('an inline policy grants ACTIONS only — it can never satisfy a SUPER_ADMIN-only (@Roles) route', async () => {
      userRoles.set(USER_ID, [AUDITOR]);
      grantInline(USER_ID, 'APPROVE_TARIFF', 'VIEW_METER', 'EDIT_METER');

      expect(await roleAllowed(tokenIssuedAs(AUDITOR), 'rootOnly')).toBe(false);
    });

    it('a user with NO roles is still rejected outright, inline policies or not (a role-less login is never valid)', async () => {
      userRoles.set(USER_ID, []);
      grantInline(USER_ID, 'APPROVE_TARIFF');

      await expect(strategy.validate(tokenIssuedAs(FINANCE))).rejects.toThrow(new UnauthorizedException('No role assigned'));
    });
  });
});

// The other half of "never trust role claims inside the JWT": the token itself carries ONLY the primary
// role at issue time — never the live role set — so there is nothing multi-role in it to go stale.
describe('Issued tokens carry the primary role only — never the live role set', () => {
  const PASSWORD = 'CorrectHorseBatteryStaple1';
  let passwordHash: string;
  let jwt: { sign: jest.Mock };
  let users: { findByEmailWithPasswordHash: jest.Mock; updateLastLogin: jest.Mock; findOne: jest.Mock };
  let refreshTokens: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let authService: AuthService;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  beforeEach(() => {
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    users = {
      findByEmailWithPasswordHash: jest.fn().mockResolvedValue({ id: USER_ID, email: 'staff@ccb.local', passwordHash, active: true, mustChangePassword: false }),
      updateLastLogin: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue({ id: USER_ID, email: 'staff@ccb.local', active: true }),
    };
    // Two roles held; the PRIMARY (first by assignment order) is OPERATIONS.
    const userRolesStub = { getPrimaryRole: jest.fn().mockResolvedValue({ roleId: OPERATIONS.id, roleName: OPERATIONS.roleName }) };
    refreshTokens = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        userId: USER_ID,
        principalType: 'staff',
        family: 'family-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        deviceId: null,
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const loginHistory = {
      createQueryBuilder: jest.fn().mockReturnValue({ update: () => ({ set: () => ({ where: () => ({ execute: async () => undefined }) }) }) }),
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((x: unknown) => x),
    };

    authService = new AuthService(
      users as never,
      userRolesStub as never,
      {} as never, // CustomerService
      jwt as never,
      { get: jest.fn((_key: string, fallback?: string) => fallback ?? '1h'), getOrThrow: jest.fn().mockReturnValue('1h') } as never,
      { getValueByKey: jest.fn().mockResolvedValue(null) } as never,
      {} as never, // LovService
      {} as never, // RegistrationRequestService
      {} as never, // AuditService
      refreshTokens as never,
      {} as never, // UserDevice repo — only touched when a deviceId is supplied
      loginHistory as never,
    );
  });

  const EXPECTED_PAYLOAD = { sub: USER_ID, email: 'staff@ccb.local', roleId: OPERATIONS.id, roleName: 'OPERATIONS', type: 'staff' };

  it('login signs exactly { sub, email, roleId, roleName, type } — the primary role — and no roleIds/roleNames', async () => {
    await authService.login({ email: 'staff@ccb.local', password: PASSWORD });

    expect(jwt.sign).toHaveBeenCalledTimes(1);
    const [signed] = jwt.sign.mock.calls[0];
    expect(signed).toEqual(EXPECTED_PAYLOAD);
    expect(signed).not.toHaveProperty('roleIds');
    expect(signed).not.toHaveProperty('roleNames');
  });

  it('refresh re-reads the primary role and signs the same payload shape — still no roleIds/roleNames', async () => {
    await authService.refresh('a-refresh-token');

    expect(jwt.sign).toHaveBeenCalledTimes(1);
    const [signed] = jwt.sign.mock.calls[0];
    expect(signed).toEqual(EXPECTED_PAYLOAD);
    expect(signed).not.toHaveProperty('roleIds');
    expect(signed).not.toHaveProperty('roleNames');
  });
});
