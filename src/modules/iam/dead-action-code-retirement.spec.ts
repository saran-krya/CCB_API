import { ACTIONS } from '../../bootstrap/seed-data';
import { ACTION_TO_RESOURCE_CODE, RESOURCES } from './resource-catalog';
import { DEAD_ACTION_CODES } from '../../migrations/1793100000000-RetireDeadActionCodes';

// RBAC cleanup audit: CREATE_ATTRIBUTE, DELETE_ATTRIBUTE and EXPORT_BILLING_CYCLE were confirmed —
// via a full grep of every controller, service and frontend caller — to gate NO real capability on
// either side (attribute.controller.ts never had a create/delete route; billing-cycle.controller.ts
// never had an export route). Unlike 1792800000000-ConsolidateDuplicateActionCodes.ts, there is no
// surviving code to fold these onto; they are simply retired (see that migration file's own comment
// for the exact mechanics: isActive=false, stripped from existing policy_statements, verified
// against the real dev database before and after the migration ran).
describe('Dead Action code retirement — CREATE_ATTRIBUTE/DELETE_ATTRIBUTE/EXPORT_BILLING_CYCLE', () => {
  it('no dead code is selectable in the live Resource catalog (resource-catalog.ts)', () => {
    const allLiveActionCodes = new Set(RESOURCES.flatMap((r) => r.actionCodes));
    for (const deadCode of DEAD_ACTION_CODES) {
      expect(allLiveActionCodes.has(deadCode)).toBe(false);
    }
  });

  it('no dead code has a seed-data.ts ACTIONS entry (a fresh install never creates them)', () => {
    const seededCodes = new Set(ACTIONS.map((a) => a.code));
    for (const deadCode of DEAD_ACTION_CODES) {
      expect(seededCodes.has(deadCode)).toBe(false);
    }
  });

  it('no dead code has a Resource mapping left behind (ACTION_TO_RESOURCE_CODE)', () => {
    for (const deadCode of DEAD_ACTION_CODES) {
      expect(ACTION_TO_RESOURCE_CODE[deadCode]).toBeUndefined();
    }
  });

  it('the ATTRIBUTE resource keeps its real, live codes (VIEW_ATTRIBUTE, EDIT_ATTRIBUTE) untouched', () => {
    const attribute = RESOURCES.find((r) => r.code === 'ATTRIBUTE');
    expect(attribute?.actionCodes).toEqual(expect.arrayContaining(['VIEW_ATTRIBUTE', 'EDIT_ATTRIBUTE']));
    expect(attribute?.actionCodes).toHaveLength(2);
  });

  it('the BILLING_CYCLE resource keeps every other real, live code untouched', () => {
    const billingCycle = RESOURCES.find((r) => r.code === 'BILLING_CYCLE');
    expect(billingCycle?.actionCodes).toEqual(expect.arrayContaining([
      'CREATE_BILLING_CYCLE', 'BILLING_CYCLE_RESUBMIT', 'BILLING_CYCLE_NEW_VERSION',
      'BILLING_CYCLE_DEPRECATE', 'VIEW_BILLING_CYCLE', 'BILLING_CYCLE_APPROVE', 'BILLING_CYCLE_REJECT',
    ]));
    expect(billingCycle?.actionCodes).not.toContain('EXPORT_BILLING_CYCLE');
  });
});
