import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RolePermissionsService } from './role-permissions.service';
import { RolePermission } from './entities/role-permission.entity';
import { Role } from '../role/entities/role.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';
import { Action } from '../actions/entities/action.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';
import { Screen } from '../screens/entities/screen.entity';
import { AuditService } from '../../audit/audit.service';
import { IamService } from '../iam/iam.service';
import { Resource } from '../iam/entities/resource.entity';
import { Policy } from '../iam/entities/policy.entity';
import { PolicyStatement } from '../iam/entities/policy-statement.entity';
import { RolePolicy } from '../iam/entities/role-policy.entity';
import { UserInlinePolicy } from '../iam/entities/user-inline-policy.entity';
import { RoleInlinePolicy } from '../iam/entities/role-inline-policy.entity';
import { ACTIONS } from '../../bootstrap/seed-data';
import { ACTION_TO_RESOURCE_CODE, NAV_ONLY_ACTION_CODES, RESOURCES } from '../iam/resource-catalog';

// Isolated tests for the IAM migration's FULL CUTOVER: roleHasAction now resolves EVERY role
// exclusively through IamService.roleHasActionViaPolicy — there is no more "has the role attached
// at least one Policy" branch, and the legacy role_permissions table is never queried here again,
// for any role, including one with zero attached Policies. This directly proves the "one clear
// source of truth, no OR-based fallback that can override a Policy revocation" requirement.
describe('RolePermissionsService.roleHasAction — full IAM cutover (policy-only)', () => {
  let service: RolePermissionsService;
  let roleHasActionViaPolicy: jest.Mock;
  let getActionCodesGrantedByPolicies: jest.Mock;
  let rolesHaveActionViaPolicy: jest.Mock;
  let getActionCodesGrantedByPoliciesForRoles: jest.Mock;
  let rolePermissionRepoMock: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    roleHasActionViaPolicy = jest.fn();
    getActionCodesGrantedByPolicies = jest.fn();
    rolesHaveActionViaPolicy = jest.fn();
    getActionCodesGrantedByPoliciesForRoles = jest.fn();
    // Deliberately wired so that if roleHasAction ever regressed to touching the legacy table again,
    // this mock would throw loudly instead of silently returning a plausible-looking count.
    rolePermissionRepoMock = {
      createQueryBuilder: jest.fn(() => {
        throw new Error('roleHasAction must never query role_permissions after the full IAM cutover');
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RolePermissionsService,
        { provide: getRepositoryToken(RolePermission), useValue: rolePermissionRepoMock },
        { provide: getRepositoryToken(Role), useValue: {} },
        { provide: getRepositoryToken(SubModule), useValue: {} },
        { provide: getRepositoryToken(Action), useValue: {} },
        { provide: getRepositoryToken(PModule), useValue: {} },
        { provide: getRepositoryToken(Screen), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: AuditService, useValue: {} },
        {
          provide: IamService,
          useValue: {
            roleHasActionViaPolicy,
            getActionCodesGrantedByPolicies,
            rolesHaveActionViaPolicy,
            getActionCodesGrantedByPoliciesForRoles,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(RolePermissionsService);
  });

  it('delegates directly to IamService.roleHasActionViaPolicy and returns its result', async () => {
    roleHasActionViaPolicy.mockResolvedValue(true);

    const result = await service.roleHasAction(5, 'VIEW_CUSTOMER');

    expect(result).toBe(true);
    expect(roleHasActionViaPolicy).toHaveBeenCalledWith(5, 'VIEW_CUSTOMER');
    expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('a role whose attached Policy does not grant the action is denied — never falls back to the legacy table', async () => {
    roleHasActionViaPolicy.mockResolvedValue(false);

    const result = await service.roleHasAction(5, 'DELETE_CUSTOMER');

    expect(result).toBe(false);
    expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('a role with ZERO attached Policies (e.g. Technical, user01, user02 — none had actionable legacy grants) resolves to false, never reading role_permissions', async () => {
    roleHasActionViaPolicy.mockResolvedValue(false);

    const result = await service.roleHasAction(20, 'VIEW_COMMUNITY');

    expect(result).toBe(false);
    expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('REVOCATION PROOF: once a Policy statement is edited to remove an action, access is denied immediately — there is no legacy row left that could leak it back, because the legacy table is never consulted at all', async () => {
    roleHasActionViaPolicy.mockResolvedValue(false); // the Policy was edited to REMOVE this action

    const result = await service.roleHasAction(5, 'EDIT_CUSTOMER');

    expect(result).toBe(false);
    expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
  });

  // Backs GET /auth/me/actions — the frontend's Policy-based sidebar-visibility feature calls this to
  // learn exactly which Action codes the current session's Role holds, from the SAME resolution path
  // as roleHasAction above, never the legacy tree.
  describe('getMyActionCodes', () => {
    it('delegates to IamService.getActionCodesGrantedByPolicies and returns it as a plain array', async () => {
      getActionCodesGrantedByPolicies.mockResolvedValue(new Set(['VIEW_CUSTOMER', 'EDIT_CUSTOMER']));

      const result = await service.getMyActionCodes(5);

      expect(getActionCodesGrantedByPolicies).toHaveBeenCalledWith(5);
      expect(result.sort()).toEqual(['EDIT_CUSTOMER', 'VIEW_CUSTOMER']);
      expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('a role with zero attached Policies gets an empty array, never a legacy-table fallback', async () => {
      getActionCodesGrantedByPolicies.mockResolvedValue(new Set());

      const result = await service.getMyActionCodes(20);

      expect(result).toEqual([]);
      expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // Multi-role: a USER may hold several roles, so PermissionGuard and every service-level permission
  // check authorize against the user's LIVE role set. These resolve through the exact same Policy-only
  // path as the single-role methods above (IamService), never the legacy table — and never by
  // fanning out into one single-role call per role.
  describe('rolesHaveAction — the user-level check over the live role set', () => {
    it('hands the WHOLE role set to IamService.rolesHaveActionViaPolicy in one call and returns its result', async () => {
      rolesHaveActionViaPolicy.mockResolvedValue(true);

      const result = await service.rolesHaveAction([5, 8], 'VIEW_CUSTOMER');

      expect(result).toBe(true);
      expect(rolesHaveActionViaPolicy).toHaveBeenCalledTimes(1);
      expect(rolesHaveActionViaPolicy).toHaveBeenCalledWith([5, 8], 'VIEW_CUSTOMER', undefined);
      expect(roleHasActionViaPolicy).not.toHaveBeenCalled();
      expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it("forwards the user id so the user's OWN inline policies join the same single resolution", async () => {
      rolesHaveActionViaPolicy.mockResolvedValue(true);

      const result = await service.rolesHaveAction([5, 8], 'VIEW_CUSTOMER', 42);

      expect(result).toBe(true);
      expect(rolesHaveActionViaPolicy).toHaveBeenCalledTimes(1);
      expect(rolesHaveActionViaPolicy).toHaveBeenCalledWith([5, 8], 'VIEW_CUSTOMER', 42);
      expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('is false when no role in the set holds the action — never falls back to the legacy table', async () => {
      rolesHaveActionViaPolicy.mockResolvedValue(false);

      const result = await service.rolesHaveAction([5, 8], 'DELETE_CUSTOMER');

      expect(result).toBe(false);
      expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('an EMPTY role set is passed straight through (IamService resolves it to false without querying)', async () => {
      rolesHaveActionViaPolicy.mockResolvedValue(false);

      const result = await service.rolesHaveAction([], 'VIEW_CUSTOMER');

      expect(result).toBe(false);
      expect(rolesHaveActionViaPolicy).toHaveBeenCalledWith([], 'VIEW_CUSTOMER', undefined);
      expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('getMyActionCodesForRoles — the UNION across the live role set (GET /auth/me/actions)', () => {
    it('hands the whole role set to IamService.getActionCodesGrantedByPoliciesForRoles and returns the union as a plain array', async () => {
      getActionCodesGrantedByPoliciesForRoles.mockResolvedValue(new Set(['VIEW_CUSTOMER', 'EDIT_CUSTOMER', 'APPROVE_TARIFF']));

      const result = await service.getMyActionCodesForRoles([5, 8]);

      expect(getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledTimes(1);
      expect(getActionCodesGrantedByPoliciesForRoles).toHaveBeenCalledWith([5, 8], undefined);
      expect(getActionCodesGrantedByPolicies).not.toHaveBeenCalled();
      expect(result.sort()).toEqual(['APPROVE_TARIFF', 'EDIT_CUSTOMER', 'VIEW_CUSTOMER']);
      expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('an empty role set gets an empty array, never a legacy-table fallback', async () => {
      getActionCodesGrantedByPoliciesForRoles.mockResolvedValue(new Set());

      const result = await service.getMyActionCodesForRoles([]);

      expect(result).toEqual([]);
      expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});

// The same service over the REAL IamService (only the repositories are in-memory): proves the
// single-role and multi-role entry points are one resolution path end to end — union across roles, a
// grant-less role never subtracting, one `roleId IN (...)` query, and nothing for an empty role set.
describe('RolePermissionsService over the real IamService — multi-role union end to end', () => {
  let service: RolePermissionsService;
  let rolePoliciesFind: jest.Mock;
  let rolePermissionRepoMock: { createQueryBuilder: jest.Mock };

  const FINANCE = 5;
  const OPERATIONS = 8;
  const GRANTLESS = 20;

  // role_policies rows, one per (role, policy) attachment — what the DB would return for `find`.
  const ROLE_POLICY_ROWS = [
    { roleId: FINANCE, policy: { statements: [{ effect: 'Allow', actions: ['VIEW_CUSTOMER', 'APPROVE_TARIFF'] }] } },
    {
      roleId: OPERATIONS,
      policy: {
        statements: [
          { effect: 'Allow', actions: ['EDIT_CUSTOMER'] },
          { effect: 'Deny', actions: ['APPROVE_TARIFF'] }, // never written by the app; must still never subtract
        ],
      },
    },
  ];

  beforeEach(async () => {
    rolePermissionRepoMock = {
      createQueryBuilder: jest.fn(() => {
        throw new Error('authorization must never query role_permissions after the full IAM cutover');
      }),
    };
    // `where.roleId` is TypeORM's In(...) operator — at runtime its `.value` is the requested id array.
    rolePoliciesFind = jest.fn(({ where }: { where: { roleId: { value: number[] } } }) =>
      Promise.resolve(ROLE_POLICY_ROWS.filter((row) => where.roleId.value.includes(row.roleId))),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        RolePermissionsService,
        IamService,
        { provide: getRepositoryToken(RolePermission), useValue: rolePermissionRepoMock },
        { provide: getRepositoryToken(Role), useValue: {} },
        { provide: getRepositoryToken(SubModule), useValue: {} },
        { provide: getRepositoryToken(Action), useValue: {} },
        { provide: getRepositoryToken(PModule), useValue: {} },
        { provide: getRepositoryToken(Screen), useValue: {} },
        { provide: getRepositoryToken(Resource), useValue: {} },
        { provide: getRepositoryToken(Policy), useValue: {} },
        { provide: getRepositoryToken(PolicyStatement), useValue: {} },
        { provide: getRepositoryToken(RolePolicy), useValue: { find: rolePoliciesFind } },
        { provide: getRepositoryToken(UserInlinePolicy), useValue: { find: jest.fn().mockResolvedValue([]) } },
        // This file proves role-attached Policy resolution semantics only — no test here exercises a
        // role's OWN inline policies, so an always-empty mock preserves every existing assertion.
        { provide: getRepositoryToken(RoleInlinePolicy), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: DataSource, useValue: {} },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(RolePermissionsService);
  });

  it('rolesHaveAction is the union: a code granted by only ONE of the roles is held, in either order', async () => {
    expect(await service.rolesHaveAction([FINANCE, OPERATIONS], 'EDIT_CUSTOMER')).toBe(true);
    expect(await service.rolesHaveAction([OPERATIONS, FINANCE], 'VIEW_CUSTOMER')).toBe(true);
    expect(await service.rolesHaveAction([FINANCE, OPERATIONS], 'DELETE_CUSTOMER')).toBe(false);
  });

  it('a non-Allow statement on one role never subtracts what another role grants', async () => {
    expect(await service.rolesHaveAction([OPERATIONS], 'APPROVE_TARIFF')).toBe(false);
    expect(await service.rolesHaveAction([FINANCE, OPERATIONS], 'APPROVE_TARIFF')).toBe(true);
  });

  it('a role that grants nothing never removes another role\'s grant', async () => {
    expect(await service.rolesHaveAction([GRANTLESS, FINANCE], 'VIEW_CUSTOMER')).toBe(true);
    expect(await service.rolesHaveAction([GRANTLESS], 'VIEW_CUSTOMER')).toBe(false);
  });

  it('getMyActionCodesForRoles returns each granted code once across all roles', async () => {
    const codes = await service.getMyActionCodesForRoles([FINANCE, OPERATIONS, GRANTLESS]);

    expect([...codes].sort()).toEqual(['APPROVE_TARIFF', 'EDIT_CUSTOMER', 'VIEW_CUSTOMER']);
  });

  it('one query per call, however many roles — and none at all for an empty role set', async () => {
    await service.rolesHaveAction([FINANCE, OPERATIONS, GRANTLESS], 'VIEW_CUSTOMER');
    expect(rolePoliciesFind).toHaveBeenCalledTimes(1);

    rolePoliciesFind.mockClear();
    expect(await service.rolesHaveAction([], 'VIEW_CUSTOMER')).toBe(false);
    expect(await service.getMyActionCodesForRoles([])).toEqual([]);
    expect(rolePoliciesFind).not.toHaveBeenCalled();
  });

  it('the single-role entry points (roleHasAction / getMyActionCodes) are the same resolution for one role', async () => {
    expect(await service.roleHasAction(FINANCE, 'APPROVE_TARIFF')).toBe(await service.rolesHaveAction([FINANCE], 'APPROVE_TARIFF'));
    expect(await service.roleHasAction(OPERATIONS, 'APPROVE_TARIFF')).toBe(false);
    expect((await service.getMyActionCodes(FINANCE)).sort()).toEqual((await service.getMyActionCodesForRoles([FINANCE])).sort());
    expect(rolePermissionRepoMock.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe('Resource-to-Action mapping — static correctness (requirement: validate every mapping, no ambiguous/unmapped codes)', () => {
  it('every seeded Action code that is NOT a Policy/Resource admin-screen nav action maps to exactly one Resource', () => {
    const realCodes = new Set(ACTIONS.map((a) => a.code).filter((c) => !NAV_ONLY_ACTION_CODES.has(c)));
    const mappedCodes = new Set(Object.keys(ACTION_TO_RESOURCE_CODE));

    const missing = [...realCodes].filter((c) => !mappedCodes.has(c));
    expect(missing).toEqual([]);
  });

  it('the mapping contains no code mapped to more than one Resource (ACTION_TO_RESOURCE_CODE itself throws at import time if this is violated, so a clean import is the proof)', () => {
    expect(Object.keys(ACTION_TO_RESOURCE_CODE).length).toBeGreaterThan(0);
  });

  it('every Resource with a parentResourceCode references a Resource that actually exists in the catalog', () => {
    const resourceCodes = new Set(RESOURCES.map((r) => r.code));
    const badParents = RESOURCES.filter((r) => r.parentResourceCode && !resourceCodes.has(r.parentResourceCode));
    expect(badParents).toEqual([]);
  });

  it('the completed Registration Approval permission split survives the Resource model — APPROVE and DEPOSIT_MANAGE are distinct action codes on the same Resource, never merged', () => {
    const registrationResource = RESOURCES.find((r) => r.code === 'REGISTRATION_REQUEST')!;
    // Post-consolidation (1792800000000-ConsolidateDuplicateActionCodes.ts), the surviving "approve"
    // code is APPROVE_REGISTRATION_REQUEST — REGISTRATION_APPROVAL_APPROVE (the old Registration
    // Approval screen's duplicate of it) was retired and folded in, since it was confirmed to gate
    // the exact same capability, never an independent one. DEPOSIT_MANAGE was a genuinely distinct
    // capability from the start and was untouched by that consolidation.
    expect(registrationResource.actionCodes).toContain('APPROVE_REGISTRATION_REQUEST');
    expect(registrationResource.actionCodes).toContain('REGISTRATION_APPROVAL_DEPOSIT_MANAGE');
    expect(registrationResource.actionCodes).not.toContain('REGISTRATION_APPROVAL_APPROVE');
    // They remain separately grantable action codes within the same resource's statement — a Policy
    // author can include one without the other.
    expect(ACTION_TO_RESOURCE_CODE['APPROVE_REGISTRATION_REQUEST']).toBe('REGISTRATION_REQUEST');
    expect(ACTION_TO_RESOURCE_CODE['REGISTRATION_APPROVAL_DEPOSIT_MANAGE']).toBe('REGISTRATION_REQUEST');
  });
});
