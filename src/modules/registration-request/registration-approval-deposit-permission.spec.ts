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
// narrower replacement code. A later phase (1792800000000-ConsolidateDuplicateActionCodes.ts)
// retired REGISTRATION_APPROVAL_APPROVE itself — confirmed to be a duplicate of
// APPROVE_REGISTRATION_REQUEST for the exact same capability, unrelated to this deposit split —
// folding it onto that surviving code; this suite's assertions were updated to match (see the two
// approve-route tests below testing the retired code is now rejected, not accepted). This suite
// reads the REAL @Permission metadata off the real controller
// methods via Reflector (never a hand-copied code list that could silently drift from the actual
// decorators) and exercises the real PermissionGuard against a mocked role-permission lookup — no
// real database connection.
describe('RegistrationRequestController deposit-permission split', () => {
  let guard: PermissionGuard;
  let reflector: Reflector;
  let rolesHaveAction: jest.Mock;

  const DEPOSIT_HANDLERS = [
    'requestDeposit',
    'recordDepositPayment',
    'verifyDeposit',
    'returnReceiptForCorrection',
  ] as const;

  beforeEach(async () => {
    rolesHaveAction = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PermissionGuard,
        { provide: RolePermissionsService, useValue: { rolesHaveAction } },
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
        getRequest: () => ({ user: { sub: roleId, roleId, roleName: 'TEST_ROLE', roleIds: [roleId], roleNames: ['TEST_ROLE'], type: 'staff' } }),
      }),
    } as unknown as ExecutionContext;
  }

  it.each(DEPOSIT_HANDLERS)(
    'a role holding ONLY REGISTRATION_APPROVAL_DEPOSIT_MANAGE can reach %s',
    async (methodName) => {
      const codes = requiredCodesFor(methodName);
      expect(codes).toContain('REGISTRATION_APPROVAL_DEPOSIT_MANAGE');

      rolesHaveAction.mockImplementation((_roleIds: number[], code: string) =>
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
      rolesHaveAction.mockImplementation((_roleIds: number[], code: string) =>
        Promise.resolve(code === 'REGISTRATION_APPROVAL_APPROVE'),
      );

      const allowed = await guard.canActivate(mockContext(methodName));
      expect(allowed).toBe(false);
    },
  );

  it('REGISTRATION_APPROVAL_DEPOSIT_MANAGE alone does NOT satisfy the real approve route', async () => {
    const approveCodes = requiredCodesFor('approve');
    expect(approveCodes).not.toContain('REGISTRATION_APPROVAL_DEPOSIT_MANAGE');
    // Post-consolidation (1792800000000-ConsolidateDuplicateActionCodes.ts): REGISTRATION_APPROVAL_APPROVE
    // was retired and folded into APPROVE_REGISTRATION_REQUEST — confirmed the same underlying
    // capability (this file's own original comment already called it "an alternate to
    // APPROVE_REGISTRATION_REQUEST"), so the approve route now requires only the one surviving code.
    expect(approveCodes).toEqual(['APPROVE_REGISTRATION_REQUEST']);

    rolesHaveAction.mockImplementation((_roleIds: number[], code: string) =>
      Promise.resolve(code === 'REGISTRATION_APPROVAL_DEPOSIT_MANAGE'),
    );

    const allowed = await guard.canActivate(mockContext('approve'));
    expect(allowed).toBe(false);
  });

  it('the reject route is untouched by the deposit split, but simplified by the later duplicate-code consolidation to its one surviving code', async () => {
    const rejectCodes = requiredCodesFor('reject');
    expect(rejectCodes).toEqual(['REJECT_REGISTRATION_REQUEST']);
  });

  it.each(DEPOSIT_HANDLERS)(
    'existing access via EDIT_REGISTRATION_REQUEST alone still works for %s (unchanged)',
    async (methodName) => {
      rolesHaveAction.mockImplementation((_roleIds: number[], code: string) =>
        Promise.resolve(code === 'EDIT_REGISTRATION_REQUEST'),
      );

      const allowed = await guard.canActivate(mockContext(methodName));
      expect(allowed).toBe(true);
    },
  );

  it('a role holding none of the two remaining deposit-route codes is correctly denied on every deposit route', async () => {
    rolesHaveAction.mockResolvedValue(false);

    for (const methodName of DEPOSIT_HANDLERS) {
      const allowed = await guard.canActivate(mockContext(methodName));
      expect(allowed).toBe(false);
    }
  });

  it('the approve route no longer accepts the retired REGISTRATION_APPROVAL_APPROVE alone — consolidated into APPROVE_REGISTRATION_REQUEST', async () => {
    rolesHaveAction.mockImplementation((_roleIds: number[], code: string) =>
      Promise.resolve(code === 'REGISTRATION_APPROVAL_APPROVE'),
    );

    const allowed = await guard.canActivate(mockContext('approve'));
    expect(allowed).toBe(false);
  });

  it('the approve route still accepts APPROVE_REGISTRATION_REQUEST alone, unaffected by the split', async () => {
    rolesHaveAction.mockImplementation((_roleIds: number[], code: string) =>
      Promise.resolve(code === 'APPROVE_REGISTRATION_REQUEST'),
    );

    const allowed = await guard.canActivate(mockContext('approve'));
    expect(allowed).toBe(true);
  });

  // Regression test matching CUSTOMER_SERVICE_SUPERVISOR's real grant combination, originally
  // {REGISTRATION_APPROVAL_APPROVE, REGISTRATION_APPROVAL_DEPOSIT_MANAGE} (confirmed via a live,
  // read-only query before the deposit-split phase's controller change). The duplicate-code
  // consolidation migration (1792800000000-ConsolidateDuplicateActionCodes.ts) rewrites any
  // PolicyStatement holding the retired REGISTRATION_APPROVAL_APPROVE to hold
  // APPROVE_REGISTRATION_REQUEST instead, so this role's real, POST-migration grant combination is
  // {APPROVE_REGISTRATION_REQUEST, REGISTRATION_APPROVAL_DEPOSIT_MANAGE} — proving its effective
  // access across every route either phase touched is unchanged, end to end.
  it("CUSTOMER_SERVICE_SUPERVISOR's real (post-migration) grant combination reaches approve AND all 4 deposit routes", async () => {
    const heldCodes = new Set(['APPROVE_REGISTRATION_REQUEST', 'REGISTRATION_APPROVAL_DEPOSIT_MANAGE']);
    rolesHaveAction.mockImplementation((_roleIds: number[], code: string) => Promise.resolve(heldCodes.has(code)));

    expect(await guard.canActivate(mockContext('approve'))).toBe(true);
    for (const methodName of DEPOSIT_HANDLERS) {
      expect(await guard.canActivate(mockContext(methodName))).toBe(true);
    }
  });
});
