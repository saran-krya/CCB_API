import { SCREENS, SUB_MODULES } from '../../bootstrap/seed-data';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';
import {
  ADMINISTRATION_ACTION_CODES,
  ADMINISTRATION_RESOURCE_CODES,
  ADMINISTRATION_SCREEN_CODES,
  ADMINISTRATION_SUB_MODULE_CODES,
  administrationActionCodesIn,
  administrationGrantMessage,
  isAdministrationActionCode,
} from './administration-permissions';
import { NAV_ONLY_ACTION_CODES, RESOURCES } from './resource-catalog';

// The administration console's permissions belong to SUPER_ADMIN alone. This file pins WHAT they are, so that a code added to the Users or Roles
// resource later is protected without anyone remembering to list it, and a business permission can never be swept in by mistake. HOW they are
// enforced is tested where it happens (iam-business-approval.spec.ts: the resolver and the policy writes; role-permissions.service.spec.ts: the
// legacy tree; role-dropdown / role-list / user specs: visibility).
describe('administration permissions (administration-permissions.ts)', () => {
  const ADMINISTRATION_RESOURCES = RESOURCES.filter((resource) => ADMINISTRATION_RESOURCE_CODES.has(resource.code));

  /** One named yes/no check: a failure's diff names the code it is about (Jest's expect takes no message argument). */
  const flag = (label: string, actual: boolean, expected: boolean) => expect({ [label]: actual }).toEqual({ [label]: expected });

  it('are exactly the Users and Roles actions plus the nav-only Policy and Resource codes', () => {
    expect([...ADMINISTRATION_ACTION_CODES].sort()).toEqual(
      [
        ACTION_CODES.VIEW_USER,
        ACTION_CODES.CREATE_USER,
        ACTION_CODES.EDIT_USER,
        ACTION_CODES.DELETE_USER,
        ACTION_CODES.RESET_USER_PASSWORD,
        ACTION_CODES.VIEW_ROLE,
        ACTION_CODES.CREATE_ROLE,
        ACTION_CODES.EDIT_ROLE,
        ACTION_CODES.DELETE_ROLE,
        ACTION_CODES.VIEW_POLICY,
        ACTION_CODES.CREATE_POLICY,
        ACTION_CODES.EDIT_POLICY,
        ACTION_CODES.DELETE_POLICY,
        ACTION_CODES.VIEW_RESOURCE,
      ].sort(),
    );
  });

  it('are derived from the catalogue: every action of an administration resource is in, whatever is added to it later', () => {
    expect(ADMINISTRATION_RESOURCES.map((resource) => resource.code).sort()).toEqual(['ROLE', 'USER']);
    for (const resource of ADMINISTRATION_RESOURCES) {
      for (const code of resource.actionCodes) flag(`${resource.code}: ${code}`, ADMINISTRATION_ACTION_CODES.has(code), true);
    }
    for (const code of NAV_ONLY_ACTION_CODES) flag(code, ADMINISTRATION_ACTION_CODES.has(code), true);
  });

  it('are all real catalogue codes — a typo would protect nothing', () => {
    const known = new Set<string>(Object.values(ACTION_CODES));
    for (const code of ADMINISTRATION_ACTION_CODES) flag(code, known.has(code), true);
  });

  // Decided 2026-11-12: System Attributes (ATTRIBUTE) and Lookup Values (LOV) stay assignable to authorized business roles — business modules
  // depend on them. This test fails if either is ever added to the protected set.
  it('leave every business resource, the personal Account settings, workflows, attributes and lookup values delegable', () => {
    const businessActions = RESOURCES.filter((resource) => !ADMINISTRATION_RESOURCE_CODES.has(resource.code)).flatMap((resource) => resource.actionCodes);
    expect(businessActions.length).toBeGreaterThan(0);
    for (const code of businessActions) flag(code, isAdministrationActionCode(code), false);

    for (const resourceCode of ['ACCOUNT', 'WORKFLOW', 'ATTRIBUTE', 'LOV', 'CUSTOMER', 'COMMUNITY', 'METER', 'TARIFF', 'BILL_RUN']) {
      flag(resourceCode, ADMINISTRATION_RESOURCE_CODES.has(resourceCode), false);
    }
  });

  it('name real sidebar pages: every protected sub-module and screen exists in the seed data, so the legacy tree cannot drift from them', () => {
    const subModuleCodes = new Set(SUB_MODULES.map((subModule) => subModule.code));
    const screenCodes = new Set(SCREENS.map((screen) => screen.code));
    for (const code of ADMINISTRATION_SUB_MODULE_CODES) flag(code, subModuleCodes.has(code), true);
    for (const code of ADMINISTRATION_SCREEN_CODES) flag(code, screenCodes.has(code), true);
  });

  it('do not reach into the sibling System Admin pages that are business configuration', () => {
    for (const code of ['ATTRIBUTES', 'LFM', 'DOCUMENT_SET_DEFINITION']) flag(code, ADMINISTRATION_SUB_MODULE_CODES.has(code), false);
  });

  it('administrationActionCodesIn picks the protected codes out of a list, once each and sorted', () => {
    expect(administrationActionCodesIn(['VIEW_CUSTOMER', 'EDIT_USER', 'VIEW_USER', 'EDIT_USER', 'TARIFF_VIEW'])).toEqual(['EDIT_USER', 'VIEW_USER']);
    expect(administrationActionCodesIn([])).toEqual([]);
    expect(administrationActionCodesIn(new Set(['VIEW_CUSTOMER']))).toEqual([]);
  });

  it('words a refusal in the singular and the plural', () => {
    expect(administrationGrantMessage(['VIEW_USER'])).toMatch(/^VIEW_USER is an administration permission: .*SUPER_ADMIN Administration Console alone/);
    expect(administrationGrantMessage(['EDIT_ROLE', 'VIEW_USER'])).toMatch(/^EDIT_ROLE, VIEW_USER are administration permissions: /);
  });
});
