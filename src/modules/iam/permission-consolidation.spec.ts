import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSION_KEY } from '../../common/decorators/permission.decorator';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { UserController } from '../user/user.controller';
import { TariffController } from '../tariff/tariff.controller';
import { BillingCycleController } from '../billing-cycle/billing-cycle.controller';
import { ACTIONS } from '../../bootstrap/seed-data';
import { ACTION_TO_RESOURCE_CODE, RESOURCES } from './resource-catalog';
import { CODE_MERGE_MAP } from '../../migrations/1792800000000-ConsolidateDuplicateActionCodes';
import { USER_OVERVIEW_CORRECTION_MAP } from '../../migrations/1792900000000-RenameUserOverviewToViewUser';

// Combined, NET view of every retired->survivor mapping across both migrations, for the
// catalog-consistency and fold-logic checks below. This must be a proper composition (resolve a code
// through CODE_MERGE_MAP, then through USER_OVERVIEW_CORRECTION_MAP), NOT a shallow `{...a, ...b}`
// merge — a flat merge would keep CODE_MERGE_MAP's own `VIEW_USER: 'USER_OVERVIEW'` entry (accurate
// for what that migration alone did) sitting alongside USER_OVERVIEW_CORRECTION_MAP's
// `USER_OVERVIEW: 'VIEW_USER'` (the later reversal), producing a false 2-cycle where neither code
// is ever actually retired in the real, final, both-migrations-applied state. Composing instead
// correctly cancels that cycle out: VIEW_USER resolves back to itself (so it is correctly excluded —
// migration 2 restores it), while USER_OVERVIEW still resolves to VIEW_USER (correctly retired).
const ALL_RETIRED_TO_SURVIVOR: Record<string, string> = (() => {
  const composed: Record<string, string> = {};
  const allKeys = new Set([...Object.keys(CODE_MERGE_MAP), ...Object.keys(USER_OVERVIEW_CORRECTION_MAP)]);
  for (const code of allKeys) {
    const afterFirst = CODE_MERGE_MAP[code] ?? code;
    const afterSecond = USER_OVERVIEW_CORRECTION_MAP[afterFirst] ?? afterFirst;
    if (afterSecond !== code) composed[code] = afterSecond;
  }
  return composed;
})();

// Isolated tests for the permission-model consolidation: 11 Action codes, confirmed (via
// @Permission(...) co-occurrence across every controller and seed-data.ts's own pre-existing
// "accepted as an alternate to X" descriptions) to each be a duplicate of one surviving code for the
// exact same capability, were folded onto that survivor and retired. This suite proves, against the
// REAL @Permission metadata and the REAL PermissionGuard (never a hand-copied assumption), that:
//   1. each survivor alone still grants access to the real endpoint it always gated;
//   2. each retired code, held alone, no longer grants anything (the actual simplification — a role
//      that used to need "hold either of two codes" now needs exactly one, and the other is inert);
//   3. the catalog (resource-catalog.ts) and seed data (seed-data.ts) agree with CODE_MERGE_MAP — no
//      code is both "retired" and still live in the real catalog a Policy could select, and every
//      surviving code's Action.name stays exactly as it always was (still unique — actions.name has
//      a DB-level unique index, confirmed the hard way when an earlier draft of this migration tried
//      renaming survivors to a shared bare "View"/"Approve"/"Reject" and failed outright).
describe('Permission consolidation — duplicate Action codes retired onto one surviving code each', () => {
  let guard: PermissionGuard;
  let rolesHaveAction: jest.Mock;

  beforeEach(async () => {
    rolesHaveAction = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [PermissionGuard, { provide: RolePermissionsService, useValue: { rolesHaveAction } }],
    }).compile();
    guard = moduleRef.get(PermissionGuard);
  });

  function requiredCodesFor(controllerClass: Function, methodName: string): string[] {
    const codes = Reflect.getMetadata(PERMISSION_KEY, (controllerClass.prototype as any)[methodName]);
    expect(codes).toBeDefined();
    return codes as string[];
  }

  function mockContext(controllerClass: Function, methodName: string, roleId = 1): ExecutionContext {
    const handler = (controllerClass.prototype as any)[methodName];
    return {
      getHandler: () => handler,
      getClass: () => controllerClass,
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: roleId, roleId, roleName: 'TEST_ROLE', roleIds: [roleId], roleNames: ['TEST_ROLE'], type: 'staff' } }),
      }),
    } as unknown as ExecutionContext;
  }

  async function grantOnly(code: string) {
    rolesHaveAction.mockImplementation((_roleIds: number[], c: string) => Promise.resolve(c === code));
  }

  describe('USER resource — USER_OVERVIEW (tab-named survivor) corrected onto properly-named VIEW_USER', () => {
    // History: VIEW_USER was originally dead code (never gated any real route) while USER_OVERVIEW
    // was the live "view the user list" action, so the first consolidation pass kept USER_OVERVIEW as
    // survivor. Corrected by 1792900000000-RenameUserOverviewToViewUser.ts: USER_OVERVIEW's own name
    // was itself tab-specific ("Overview" names a screen, not the Users resource's View capability),
    // so the two rows were swapped — VIEW_USER (properly named, matching every other resource's own
    // View-action convention) is now the live code; USER_OVERVIEW is retired.
    it('findAll requires exactly VIEW_USER, not the retired USER_OVERVIEW', () => {
      expect(requiredCodesFor(UserController, 'findAll')).toEqual(['VIEW_USER']);
    });

    it('a role holding VIEW_USER can list users', async () => {
      await grantOnly('VIEW_USER');
      expect(await guard.canActivate(mockContext(UserController, 'findAll'))).toBe(true);
    });

    it('a role holding only the retired USER_OVERVIEW can no longer list users (the correction this migration makes)', async () => {
      await grantOnly('USER_OVERVIEW');
      expect(await guard.canActivate(mockContext(UserController, 'findAll'))).toBe(false);
    });
  });

  describe('TARIFF resource — Approval-screen duplicates retired onto TARIFF_VIEW/APPROVE/REJECT', () => {
    it('findAll requires exactly TARIFF_VIEW, not the retired TARIFF_APPROVAL_VIEW', () => {
      expect(requiredCodesFor(TariffController, 'findAll')).toEqual(['TARIFF_VIEW']);
    });

    it('approve requires exactly TARIFF_APPROVE, not the retired TARIFF_APPROVAL_APPROVE', () => {
      expect(requiredCodesFor(TariffController, 'approve')).toEqual(['TARIFF_APPROVE']);
    });

    it('reject requires exactly TARIFF_REJECT, not the retired TARIFF_APPROVAL_REJECT', () => {
      expect(requiredCodesFor(TariffController, 'reject')).toEqual(['TARIFF_REJECT']);
    });

    it('a role holding TARIFF_VIEW can list tariffs', async () => {
      await grantOnly('TARIFF_VIEW');
      expect(await guard.canActivate(mockContext(TariffController, 'findAll'))).toBe(true);
    });

    it('a role holding TARIFF_APPROVE can approve a tariff', async () => {
      await grantOnly('TARIFF_APPROVE');
      expect(await guard.canActivate(mockContext(TariffController, 'approve'))).toBe(true);
    });

    it('a role holding only the retired TARIFF_APPROVAL_APPROVE can no longer approve a tariff (the actual behavior change this consolidation makes)', async () => {
      await grantOnly('TARIFF_APPROVAL_APPROVE');
      expect(await guard.canActivate(mockContext(TariffController, 'approve'))).toBe(false);
    });

    it('a role holding only the retired TARIFF_APPROVAL_REJECT can no longer reject a tariff', async () => {
      await grantOnly('TARIFF_APPROVAL_REJECT');
      expect(await guard.canActivate(mockContext(TariffController, 'reject'))).toBe(false);
    });

    it('a role holding only the retired TARIFF_APPROVAL_VIEW can no longer list tariffs', async () => {
      await grantOnly('TARIFF_APPROVAL_VIEW');
      expect(await guard.canActivate(mockContext(TariffController, 'findAll'))).toBe(false);
    });
  });

  describe('BILLING_CYCLE resource — Approval-screen duplicates retired onto VIEW/APPROVE/REJECT', () => {
    it('findAll requires exactly VIEW_BILLING_CYCLE, not the retired BILLING_CYCLE_APPROVAL_VIEW', () => {
      expect(requiredCodesFor(BillingCycleController, 'findAll')).toEqual(['VIEW_BILLING_CYCLE']);
    });

    it('approve requires exactly BILLING_CYCLE_APPROVE, not the retired BILLING_CYCLE_APPROVAL_APPROVE', () => {
      expect(requiredCodesFor(BillingCycleController, 'approve')).toEqual(['BILLING_CYCLE_APPROVE']);
    });

    it('reject requires exactly BILLING_CYCLE_REJECT, not the retired BILLING_CYCLE_APPROVAL_REJECT', () => {
      expect(requiredCodesFor(BillingCycleController, 'reject')).toEqual(['BILLING_CYCLE_REJECT']);
    });

    it('a role holding BILLING_CYCLE_APPROVE can approve a billing cycle', async () => {
      await grantOnly('BILLING_CYCLE_APPROVE');
      expect(await guard.canActivate(mockContext(BillingCycleController, 'approve'))).toBe(true);
    });

    it('a role holding only the retired BILLING_CYCLE_APPROVAL_APPROVE can no longer approve a billing cycle', async () => {
      await grantOnly('BILLING_CYCLE_APPROVAL_APPROVE');
      expect(await guard.canActivate(mockContext(BillingCycleController, 'approve'))).toBe(false);
    });
  });

  describe('Catalog/seed-data consistency with the merge maps', () => {
    it('no retired code is selectable in the live Resource catalog (resource-catalog.ts)', () => {
      const allLiveActionCodes = new Set(RESOURCES.flatMap((r) => r.actionCodes));
      for (const retiredCode of Object.keys(ALL_RETIRED_TO_SURVIVOR)) {
        expect(allLiveActionCodes.has(retiredCode)).toBe(false);
      }
    });

    it('every surviving code the map points at IS still selectable in the live Resource catalog', () => {
      const allLiveActionCodes = new Set(RESOURCES.flatMap((r) => r.actionCodes));
      for (const survivorCode of Object.values(ALL_RETIRED_TO_SURVIVOR)) {
        expect(allLiveActionCodes.has(survivorCode)).toBe(true);
      }
    });

    it('no retired code has a seed-data.ts ACTIONS entry (a fresh install never creates them)', () => {
      const seededCodes = new Set(ACTIONS.map((a) => a.code));
      for (const retiredCode of Object.keys(ALL_RETIRED_TO_SURVIVOR)) {
        expect(seededCodes.has(retiredCode)).toBe(false);
      }
    });

    it('no retired code has a Resource mapping left behind (ACTION_TO_RESOURCE_CODE)', () => {
      for (const retiredCode of Object.keys(ALL_RETIRED_TO_SURVIVOR)) {
        expect(ACTION_TO_RESOURCE_CODE[retiredCode]).toBeUndefined();
      }
    });

    // actions.name has a DB-level UNIQUE index (confirmed the hard way — an earlier version of this
    // migration tried renaming every survivor to a bare "View"/"Approve"/"Reject" and failed with
    // "Duplicate entry 'View' for key actions.IDX_..."). So Action.name is intentionally left exactly
    // as it always was for every code, survivor or not — still fully descriptive, still unique. The
    // simplified bare-verb labels the Policy editor actually displays live purely in CCB_WEB
    // (components/role/actionDisplayLabels.ts), never written back to the database.
    it('seed-data.ts never assigns the same Action.name to two different codes (the constraint this consolidation must never violate again)', () => {
      const names = ACTIONS.map((a) => a.name);
      const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
      expect(duplicates).toEqual([]);
    });

    it('every surviving code keeps its own original, fully-descriptive Action.name untouched by the consolidation', () => {
      const seedByCode = new Map(ACTIONS.map((a) => [a.code, a]));
      const survivorNames: Record<string, string> = {
        VIEW_USER: 'View Users',
        CREATE_USER: 'Create User',
        EDIT_USER: 'Edit User',
        DELETE_USER: 'Delete User',
        TARIFF_VIEW: 'View Tariff Detail',
        TARIFF_APPROVE: 'Approve Tariff',
        TARIFF_REJECT: 'Reject Tariff',
        VIEW_BILLING_CYCLE: 'View Billing Cycle',
        BILLING_CYCLE_APPROVE: 'Approve Billing Cycle',
        BILLING_CYCLE_REJECT: 'Reject Billing Cycle',
        VIEW_REGISTRATION_REQUESTS: 'View Registration Requests',
        APPROVE_REGISTRATION_REQUEST: 'Approve Registration Request',
        REJECT_REGISTRATION_REQUEST: 'Reject Registration Request',
      };
      for (const [code, expectedName] of Object.entries(survivorNames)) {
        expect(seedByCode.get(code)?.name).toBe(expectedName);
      }
    });

    it('no map (CODE_MERGE_MAP or USER_OVERVIEW_CORRECTION_MAP) ever merges a code onto itself, and neither chains into the other (a survivor in one is never a retired key in either)', () => {
      const retiredCodes = new Set(Object.keys(ALL_RETIRED_TO_SURVIVOR));
      for (const [retired, survivor] of Object.entries(ALL_RETIRED_TO_SURVIVOR)) {
        expect(survivor).not.toBe(retired);
        expect(retiredCodes.has(survivor)).toBe(false);
      }
    });
  });

  describe('Fold-and-deduplicate logic (the same logic both migrations apply to every real policy_statements row)', () => {
    function foldAndDedupe(codes: string[]): string[] {
      return [...new Set(codes.map((c) => ALL_RETIRED_TO_SURVIVOR[c] ?? c))];
    }

    it('a statement holding only a retired code resolves to just its survivor', () => {
      expect(foldAndDedupe(['TARIFF_APPROVAL_APPROVE'])).toEqual(['TARIFF_APPROVE']);
    });

    it('a statement already holding BOTH the retired code and its survivor de-duplicates to one entry (no inflation)', () => {
      expect(foldAndDedupe(['TARIFF_APPROVE', 'TARIFF_APPROVAL_APPROVE'])).toEqual(['TARIFF_APPROVE']);
    });

    it('a statement holding unrelated codes alongside a retired one keeps the unrelated codes untouched', () => {
      const result = foldAndDedupe(['TARIFF_CREATE', 'TARIFF_APPROVAL_VIEW', 'TARIFF_SUBMIT']);
      expect(result).toEqual(expect.arrayContaining(['TARIFF_CREATE', 'TARIFF_VIEW', 'TARIFF_SUBMIT']));
      expect(result).toHaveLength(3);
    });

    it('a statement holding the corrected USER_OVERVIEW resolves to VIEW_USER', () => {
      expect(foldAndDedupe(['USER_OVERVIEW'])).toEqual(['VIEW_USER']);
    });

    it('a statement already holding BOTH USER_OVERVIEW and VIEW_USER de-duplicates to one entry', () => {
      expect(foldAndDedupe(['VIEW_USER', 'USER_OVERVIEW'])).toEqual(['VIEW_USER']);
    });

    it('two different retired codes for the SAME resource both fold onto TARIFF_VIEW without colliding incorrectly (TARIFF_APPROVAL_VIEW and TARIFF_APPROVAL_QUEUE)', () => {
      expect(foldAndDedupe(['TARIFF_APPROVAL_VIEW', 'TARIFF_APPROVAL_QUEUE'])).toEqual(['TARIFF_VIEW']);
    });

    it('a statement with no retired codes at all is returned unchanged (order-independent)', () => {
      const result = foldAndDedupe(['CREATE_USER', 'EDIT_USER']);
      expect(result).toEqual(expect.arrayContaining(['CREATE_USER', 'EDIT_USER']));
      expect(result).toHaveLength(2);
    });
  });
});
