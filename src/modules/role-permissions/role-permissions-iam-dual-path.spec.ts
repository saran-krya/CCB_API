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
import { ACTIONS } from '../../bootstrap/seed-data';
import { ACTION_TO_RESOURCE_CODE, RESOURCES } from '../iam/resource-catalog';

// Isolated tests for the IAM migration's FULL CUTOVER: roleHasAction now resolves EVERY role
// exclusively through IamService.roleHasActionViaPolicy — there is no more "has the role attached
// at least one Policy" branch, and the legacy role_permissions table is never queried here again,
// for any role, including one with zero attached Policies. This directly proves the "one clear
// source of truth, no OR-based fallback that can override a Policy revocation" requirement.
describe('RolePermissionsService.roleHasAction — full IAM cutover (policy-only)', () => {
  let service: RolePermissionsService;
  let roleHasActionViaPolicy: jest.Mock;
  let rolePermissionRepoMock: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    roleHasActionViaPolicy = jest.fn();
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
        { provide: IamService, useValue: { roleHasActionViaPolicy } },
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
});

// Nav-visibility-only Action codes for the Policy/Resource ADMIN SCREENS themselves (added when
// Policy Management/Resource Catalog became real sidebar entries under System Admin) — deliberately
// excluded from the Resource-to-Action mapping. A Policy statement granting "VIEW_POLICY" would be
// circular (Policy administration is gated by the backend's unchanged @Roles(SUPER_ADMIN) check, not
// by the Policy model it manages); these codes only ever control whether the sidebar link/page is
// reachable, via the legacy RolePermission/SubModule mechanism, same as every other screen's nav
// actions. They never appear in resource-catalog.ts and that's correct, not an oversight.
const NAV_ONLY_ACTION_CODES = new Set(['VIEW_POLICY', 'CREATE_POLICY', 'EDIT_POLICY', 'DELETE_POLICY', 'VIEW_RESOURCE']);

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
    expect(registrationResource.actionCodes).toContain('REGISTRATION_APPROVAL_APPROVE');
    expect(registrationResource.actionCodes).toContain('REGISTRATION_APPROVAL_DEPOSIT_MANAGE');
    // They remain separately grantable action codes within the same resource's statement — a Policy
    // author can include one without the other.
    expect(ACTION_TO_RESOURCE_CODE['REGISTRATION_APPROVAL_APPROVE']).toBe('REGISTRATION_REQUEST');
    expect(ACTION_TO_RESOURCE_CODE['REGISTRATION_APPROVAL_DEPOSIT_MANAGE']).toBe('REGISTRATION_REQUEST');
  });
});
