import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSION_KEY } from '../../common/decorators/permission.decorator';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { RegistrationRequestController } from './registration-request.controller';

// Isolated tests for the RBAC remediation split, now fully exclusive (Phase 3b):
// REGISTRATION_APPROVAL_APPROVE used to also gate 4 deposit-handling routes
// (request-deposit/record-deposit-payment/verify-deposit/return-receipt) it never advertised in its
// own name/description — a role granted only that code, believing it only let them approve
// registrations, silently also got deposit-handling capability. Phase 1 added
// REGISTRATION_APPROVAL_DEPOSIT_MANAGE additively (both codes worked); this phase removes
// REGISTRATION_APPROVAL_APPROVE from the 4 deposit routes entirely, once a live role-impact check
// confirmed every role needing deposit access (CUSTOMER_SERVICE_SUPERVISOR) already held the
// narrower replacement code. This suite reads the REAL @Permission metadata off the real controller
// methods via Reflector (never a hand-copied code list that could silently drift from the actual
// decorators) and exercises the real PermissionGuard against a mocked role-permission lookup — no
// real database connection.
describe('RegistrationRequestController deposit-permission split', () => {
  let guard: PermissionGuard;
  let reflector: Reflector;
  let roleHasAction: jest.Mock;

  const DEPOSIT_HANDLERS = [
    'requestDeposit',
    'recordDepositPayment',
    'verifyDeposit',
    'returnReceiptForCorrection',
  ] as const;

  beforeEach(async () => {
    roleHasAction = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PermissionGuard,
        { provide: RolePermissionsService, useValue: { roleHasAction } },
      ],
    }).compile();

    guard = moduleRef.get(PermissionGuard);
    reflector = moduleRef.get(Reflector);
  });

  function requiredCodesFor(methodName: keyof RegistrationRequestController): string[] {
    const codes = Reflect.getMetadata(PERMISSION_KEY, RegistrationRequestController.prototype[methodName]);
    expect(codes).toBeDefined(); // fails loudly if the decorator is ever removed/renamed
    return codes as string[];
  }

  function mockContext(methodName: keyof RegistrationRequestController, roleId = 99): ExecutionContext {
    const handler = RegistrationRequestController.prototype[methodName];
    return {
      getHandler: () => handler,
      getClass: () => RegistrationRequestController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: roleId, roleId, roleName: 'TEST_ROLE', type: 'staff' } }),
      }),
    } as unknown as ExecutionContext;
  }

  it.each(DEPOSIT_HANDLERS)(
    'a role holding ONLY REGISTRATION_APPROVAL_DEPOSIT_MANAGE can reach %s',
    async (methodName) => {
      const codes = requiredCodesFor(methodName);
      expect(codes).toContain('REGISTRATION_APPROVAL_DEPOSIT_MANAGE');

      roleHasAction.mockImplementation((_roleId: number, code: string) =>
        Promise.resolve(code === 'REGISTRATION_APPROVAL_DEPOSIT_MANAGE'),
      );

      const allowed = await guard.canActivate(mockContext(methodName));
      expect(allowed).toBe(true);
    },
  );

  it.each(DEPOSIT_HANDLERS)(
    'none of the 4 deposit routes list REGISTRATION_APPROVAL_APPROVE anymore — %s',
    async (methodName) => {
      const codes = requiredCodesFor(methodName);
      expect(codes).not.toContain('REGISTRATION_APPROVAL_APPROVE');
    },
  );

  it.each(DEPOSIT_HANDLERS)(
    'REGISTRATION_APPROVAL_APPROVE ALONE no longer grants access to %s (the fix this phase makes)',
    async (methodName) => {
      roleHasAction.mockImplementation((_roleId: number, code: string) =>
        Promise.resolve(code === 'REGISTRATION_APPROVAL_APPROVE'),
      );

      const allowed = await guard.canActivate(mockContext(methodName));
      expect(allowed).toBe(false);
    },
  );

  it('REGISTRATION_APPROVAL_DEPOSIT_MANAGE alone does NOT satisfy the real approve route', async () => {
    const approveCodes = requiredCodesFor('approve');
    expect(approveCodes).not.toContain('REGISTRATION_APPROVAL_DEPOSIT_MANAGE');
    expect(approveCodes).toEqual(['APPROVE_REGISTRATION_REQUEST', 'REGISTRATION_APPROVAL_APPROVE']);

    roleHasAction.mockImplementation((_roleId: number, code: string) =>
      Promise.resolve(code === 'REGISTRATION_APPROVAL_DEPOSIT_MANAGE'),
    );

    const allowed = await guard.canActivate(mockContext('approve'));
    expect(allowed).toBe(false);
  });

  it('the reject route is untouched by the split — still only its original two codes', async () => {
    const rejectCodes = requiredCodesFor('reject');
    expect(rejectCodes).toEqual(['REJECT_REGISTRATION_REQUEST', 'REGISTRATION_APPROVAL_REJECT']);
  });

  it.each(DEPOSIT_HANDLERS)(
    'existing access via EDIT_REGISTRATION_REQUEST alone still works for %s (unchanged)',
    async (methodName) => {
      roleHasAction.mockImplementation((_roleId: number, code: string) =>
        Promise.resolve(code === 'EDIT_REGISTRATION_REQUEST'),
      );

      const allowed = await guard.canActivate(mockContext(methodName));
      expect(allowed).toBe(true);
    },
  );

  it('a role holding none of the two remaining deposit-route codes is correctly denied on every deposit route', async () => {
    roleHasAction.mockResolvedValue(false);

    for (const methodName of DEPOSIT_HANDLERS) {
      const allowed = await guard.canActivate(mockContext(methodName));
      expect(allowed).toBe(false);
    }
  });

  it('the approve route still accepts REGISTRATION_APPROVAL_APPROVE alone, unaffected by the split', async () => {
    roleHasAction.mockImplementation((_roleId: number, code: string) =>
      Promise.resolve(code === 'REGISTRATION_APPROVAL_APPROVE'),
    );

    const allowed = await guard.canActivate(mockContext('approve'));
    expect(allowed).toBe(true);
  });

  it('the approve route still accepts APPROVE_REGISTRATION_REQUEST alone, unaffected by the split', async () => {
    roleHasAction.mockImplementation((_roleId: number, code: string) =>
      Promise.resolve(code === 'APPROVE_REGISTRATION_REQUEST'),
    );

    const allowed = await guard.canActivate(mockContext('approve'));
    expect(allowed).toBe(true);
  });

  // Regression test matching CUSTOMER_SERVICE_SUPERVISOR's ACTUAL real-DB grant combination
  // (confirmed via a live, read-only query before this phase's controller change):
  // REGISTRATION_APPROVAL_APPROVE + REGISTRATION_APPROVAL_DEPOSIT_MANAGE, no EDIT_REGISTRATION_REQUEST.
  // Proves this role's real, unchanged effective access across every route this phase touched.
  it("CUSTOMER_SERVICE_SUPERVISOR's real grant combination reaches approve AND all 4 deposit routes, post-split", async () => {
    const heldCodes = new Set(['REGISTRATION_APPROVAL_APPROVE', 'REGISTRATION_APPROVAL_DEPOSIT_MANAGE']);
    roleHasAction.mockImplementation((_roleId: number, code: string) => Promise.resolve(heldCodes.has(code)));

    expect(await guard.canActivate(mockContext('approve'))).toBe(true);
    for (const methodName of DEPOSIT_HANDLERS) {
      expect(await guard.canActivate(mockContext(methodName))).toBe(true);
    }
  });
});
