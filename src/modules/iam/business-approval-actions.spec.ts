import { ACTIONS } from '../../bootstrap/seed-data';
import { RESOURCES } from './resource-catalog';
import {
  APPROVE_ACTION_CODES,
  BUSINESS_APPROVAL_ACTION_CODES,
  NOT_BUSINESS_APPROVAL_ACTION_CODES,
  isBusinessApprovalActionCode,
} from './business-approval-actions';

// The classification behind "SUPER_ADMIN never approves a business transaction". It reads the REAL permission
// catalogue, so adding an approve/reject code without deciding which side of the rule it falls on fails here.
describe('business approval action classification', () => {
  const catalogueCodes = [...new Set(RESOURCES.flatMap((resource) => resource.actionCodes))];
  const readsLikeAnApproval = (code: string) => /APPROV|REJECT/.test(code);

  it('classifies every grantable code that reads like an approval or rejection — a new one fails here until someone decides', () => {
    const unclassified = catalogueCodes.filter(
      (code) =>
        readsLikeAnApproval(code) && !BUSINESS_APPROVAL_ACTION_CODES.has(code) && !(code in NOT_BUSINESS_APPROVAL_ACTION_CODES),
    );

    expect(unclassified).toEqual([]);
  });

  it('is exactly the reviewed list: the approve/reject decisions of tariffs, billing cycles, bill runs, registrations and meter readings', () => {
    expect([...BUSINESS_APPROVAL_ACTION_CODES].sort()).toEqual([
      'APPROVE_REGISTRATION_REQUEST',
      'BILLING_CYCLE_APPROVE',
      'BILLING_CYCLE_REJECT',
      'BILL_RUN_APPROVE',
      'BILL_RUN_HISTORICAL_APPROVE',
      'METER_READING_APPROVE',
      'REJECT_REGISTRATION_REQUEST',
      'TARIFF_APPROVE',
      'TARIFF_REJECT',
    ]);
  });

  it('only names real catalogue codes — a typo would silently restrict nothing', () => {
    for (const code of BUSINESS_APPROVAL_ACTION_CODES) expect(catalogueCodes).toContain(code);
    for (const code of Object.keys(NOT_BUSINESS_APPROVAL_ACTION_CODES)) expect(catalogueCodes).toContain(code);
  });

  it('keeps the two lists disjoint, and gives every deliberate exception a written reason', () => {
    for (const [code, reason] of Object.entries(NOT_BUSINESS_APPROVAL_ACTION_CODES)) {
      expect(BUSINESS_APPROVAL_ACTION_CODES.has(code)).toBe(false);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('restricts every code that lets a role approve a workflow — SUPER_ADMIN can never hold what an approver needs', () => {
    for (const codes of Object.values(APPROVE_ACTION_CODES)) {
      for (const code of codes) expect(isBusinessApprovalActionCode(code)).toBe(true);
    }
  });

  it('leaves administration, viewing and the maker steps (submit/resubmit) grantable to SUPER_ADMIN', () => {
    const keptByRule = catalogueCodes.filter((code) => /VIEW|SUBMIT|RESUBMIT|MANAGE|CREATE|EDIT|DELETE/.test(code));
    expect(keptByRule.length).toBeGreaterThan(40);
    for (const code of keptByRule) expect(isBusinessApprovalActionCode(code)).toBe(false);
    expect(isBusinessApprovalActionCode('WORKFLOW_MANAGE_APPROVERS')).toBe(false);
  });

  it('is consistent with the seeded Action rows: every restricted code that is seeded is one the catalogue maps to a resource', () => {
    const seeded = new Set(ACTIONS.map((action) => action.code));
    for (const code of BUSINESS_APPROVAL_ACTION_CODES) {
      if (seeded.has(code)) expect(catalogueCodes).toContain(code);
    }
  });
});
