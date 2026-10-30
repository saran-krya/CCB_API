import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, FindOperator } from 'typeorm';
import { IamService } from './iam.service';
import { Resource } from './entities/resource.entity';
import { Policy } from './entities/policy.entity';
import { PolicyStatement } from './entities/policy-statement.entity';
import { RolePolicy } from './entities/role-policy.entity';
import { UserInlinePolicy } from './entities/user-inline-policy.entity';
import { RoleInlinePolicy } from './entities/role-inline-policy.entity';
import { Role } from '../role/entities/role.entity';
import { Action } from '../actions/entities/action.entity';
import { AuditService } from '../../audit/audit.service';
import { RESOURCES } from './resource-catalog';
import { ACTIONS, ADMIN_GRANT_EXCLUDED_ACTION_CODES } from '../../bootstrap/seed-data';

// Isolated tests for IamService — Policy CRUD, statement validation against the real Resource/Action
// catalogs (requirement: "validate every policy statement against existing Resource and Action
// codes; reject invalid or incompatible combinations"), and the Role<->Policy attach/detach surface
// that privilege-escalation tests build on. Every dependency mocked, no real database connection.
describe('IamService', () => {
  let service: IamService;
  let resourcesRepo: { findOne: jest.Mock; find: jest.Mock };
  let policiesRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock; softRemove: jest.Mock; count: jest.Mock };
  let statementsRepo: { find: jest.Mock; delete: jest.Mock; save: jest.Mock; create: jest.Mock };
  let rolePoliciesRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock; remove: jest.Mock; count: jest.Mock; find: jest.Mock };
  let userInlinePoliciesRepo: { find: jest.Mock };
  let roleInlinePoliciesRepo: { find: jest.Mock };
  let rolesRepo: { findOne: jest.Mock; find: jest.Mock };
  let actionsRepo: { find: jest.Mock };
  let auditService: { record: jest.Mock };
  let manager: {
    getRepository: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock; manager: unknown };

  const VIEW_CUSTOMER_ACTION = { id: 1, code: 'VIEW_CUSTOMER', isActive: true };
  const EDIT_CUSTOMER_ACTION = { id: 2, code: 'EDIT_CUSTOMER', isActive: true };
  const CUSTOMER_RESOURCE = { id: 10, code: 'CUSTOMER', name: 'Customers' };
  const COMMUNITY_RESOURCE = { id: 11, code: 'COMMUNITY', name: 'Communities' };

  beforeEach(async () => {
    resourcesRepo = { findOne: jest.fn(), find: jest.fn() };
    policiesRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((p) => Promise.resolve({ id: 100, ...p })),
      create: jest.fn((data) => data),
      softRemove: jest.fn(),
      count: jest.fn(),
    };
    statementsRepo = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      save: jest.fn(),
      create: jest.fn((data) => data),
    };
    rolePoliciesRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((data) => data),
      remove: jest.fn(),
      count: jest.fn(),
      find: jest.fn(),
    };
    userInlinePoliciesRepo = { find: jest.fn().mockResolvedValue([]) };
    roleInlinePoliciesRepo = { find: jest.fn().mockResolvedValue([]) };
    rolesRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    actionsRepo = { find: jest.fn().mockResolvedValue([VIEW_CUSTOMER_ACTION, EDIT_CUSTOMER_ACTION]) };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Policy) return policiesRepo;
        if (entity === PolicyStatement) return statementsRepo;
        return {};
      }),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
      manager,
    };

    resourcesRepo.find.mockResolvedValue([CUSTOMER_RESOURCE, COMMUNITY_RESOURCE]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        IamService,
        { provide: getRepositoryToken(Resource), useValue: resourcesRepo },
        { provide: getRepositoryToken(Policy), useValue: policiesRepo },
        { provide: getRepositoryToken(PolicyStatement), useValue: statementsRepo },
        { provide: getRepositoryToken(RolePolicy), useValue: rolePoliciesRepo },
        { provide: getRepositoryToken(UserInlinePolicy), useValue: userInlinePoliciesRepo },
        { provide: getRepositoryToken(RoleInlinePolicy), useValue: roleInlinePoliciesRepo },
        { provide: getRepositoryToken(Role), useValue: rolesRepo },
        { provide: getRepositoryToken(Action), useValue: actionsRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(IamService);
    jest.spyOn(service, 'findOnePolicy').mockResolvedValue({ id: 100, name: 'Test Policy' } as any);
  });

  describe('createPolicy validation', () => {
    it('creates a policy with valid resource/action combinations', async () => {
      policiesRepo.findOne.mockResolvedValue(null);

      const result = await service.createPolicy(
        { name: 'Test Policy', statements: [{ resourceCode: 'CUSTOMER', actionCodes: ['VIEW_CUSTOMER'] }] },
        7,
      );

      expect(result).toBeDefined();
      expect(statementsRepo.save).toHaveBeenCalled();
    });

    it('rejects a statement referencing an unknown resource code', async () => {
      policiesRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createPolicy({ name: 'Bad Policy', statements: [{ resourceCode: 'NOT_A_REAL_RESOURCE', actionCodes: ['VIEW_CUSTOMER'] }] }, 7),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a statement referencing an unknown action code', async () => {
      policiesRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createPolicy({ name: 'Bad Policy', statements: [{ resourceCode: 'CUSTOMER', actionCodes: ['NOT_A_REAL_ACTION'] }] }, 7),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an action code that is real but does not belong to the stated resource (incompatible combination)', async () => {
      policiesRepo.findOne.mockResolvedValue(null);
      // VIEW_CUSTOMER is a real action, but does not belong to the COMMUNITY resource.
      await expect(
        service.createPolicy({ name: 'Bad Policy', statements: [{ resourceCode: 'COMMUNITY', actionCodes: ['VIEW_CUSTOMER'] }] }, 7),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate policy name', async () => {
      policiesRepo.findOne.mockResolvedValue({ id: 1, name: 'Test Policy' });

      await expect(
        service.createPolicy({ name: 'Test Policy', statements: [{ resourceCode: 'CUSTOMER', actionCodes: ['VIEW_CUSTOMER'] }] }, 7),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a retired action code — proves a consolidated/revoked code can never be granted again, even though it once existed (validateStatements only ever sees the isActive:true-filtered Action list)', async () => {
      policiesRepo.findOne.mockResolvedValue(null);
      // Simulates a code one of the permission-consolidation migrations marked isActive:false (e.g.
      // USER_OVERVIEW, folded into VIEW_USER) — the real actions repo query filters
      // `where: { isActive: true }`, so a retired code is simply never in this list, exactly as it
      // wouldn't be in production after 1792800000000-ConsolidateDuplicateActionCodes.ts or
      // 1792900000000-RenameUserOverviewToViewUser.ts runs.
      await expect(
        service.createPolicy({ name: 'Bad Policy', statements: [{ resourceCode: 'CUSTOMER', actionCodes: ['RETIRED_ACTION_CODE'] }] }, 7),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects the same resource appearing in two separate statements', async () => {
      policiesRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createPolicy(
          {
            name: 'Dup Resource Policy',
            statements: [
              { resourceCode: 'CUSTOMER', actionCodes: ['VIEW_CUSTOMER'] },
              { resourceCode: 'CUSTOMER', actionCodes: ['EDIT_CUSTOMER'] },
            ],
          },
          7,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updatePolicy', () => {
    it('refuses to edit a system-managed policy', async () => {
      policiesRepo.findOne.mockResolvedValue({ id: 66, name: 'SUPER_ADMIN Policy', isSystem: true });

      await expect(
        service.updatePolicy(66, { name: 'SUPER_ADMIN Policy', statements: [{ resourceCode: 'CUSTOMER', actionCodes: ['VIEW_CUSTOMER'] }] }, 7),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updatePolicy(66, { name: 'SUPER_ADMIN Policy', statements: [{ resourceCode: 'CUSTOMER', actionCodes: ['VIEW_CUSTOMER'] }] }, 7),
      ).rejects.toThrow(/system-managed/);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a policy that does not exist', async () => {
      policiesRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updatePolicy(999, { name: 'Anything', statements: [{ resourceCode: 'CUSTOMER', actionCodes: ['VIEW_CUSTOMER'] }] }, 7),
      ).rejects.toThrow(NotFoundException);
    });

    it('still allows editing an ordinary, non-system policy', async () => {
      policiesRepo.findOne.mockResolvedValueOnce({ id: 100, name: 'Custom Policy', isSystem: false }).mockResolvedValueOnce(null);
      statementsRepo.find.mockResolvedValue([]);

      const result = await service.updatePolicy(
        100,
        { name: 'Custom Policy', statements: [{ resourceCode: 'CUSTOMER', actionCodes: ['VIEW_CUSTOMER'] }] },
        7,
      );

      expect(result).toBeDefined();
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('removePolicy', () => {
    it('refuses to delete a policy that is still attached to any role', async () => {
      policiesRepo.findOne.mockResolvedValue({ id: 100, name: 'Test Policy' });
      rolePoliciesRepo.count.mockResolvedValue(2);

      await expect(service.removePolicy(100, 7)).rejects.toThrow(ConflictException);
      expect(policiesRepo.softRemove).not.toHaveBeenCalled();
    });

    it('deletes a policy with zero attachments', async () => {
      policiesRepo.findOne.mockResolvedValue({ id: 100, name: 'Test Policy' });
      rolePoliciesRepo.count.mockResolvedValue(0);

      const result = await service.removePolicy(100, 7);

      expect(result).toEqual({ message: 'Policy deleted successfully' });
      expect(policiesRepo.softRemove).toHaveBeenCalled();
    });

    it('throws NotFoundException for a policy that does not exist', async () => {
      policiesRepo.findOne.mockResolvedValue(null);
      await expect(service.removePolicy(999, 7)).rejects.toThrow(NotFoundException);
    });

    it('refuses to delete a system-managed policy, even with zero role attachments', async () => {
      policiesRepo.findOne.mockResolvedValue({ id: 66, name: 'SUPER_ADMIN Policy', isSystem: true });
      rolePoliciesRepo.count.mockResolvedValue(0);

      await expect(service.removePolicy(66, 7)).rejects.toThrow(ForbiddenException);
      await expect(service.removePolicy(66, 7)).rejects.toThrow(/system-managed/);
      expect(policiesRepo.softRemove).not.toHaveBeenCalled();
      // The system-managed check must run BEFORE the attachment-count check, so the real reason is
      // always reported — never the generic "detach it first" message a system policy can't act on.
      expect(rolePoliciesRepo.count).not.toHaveBeenCalled();
    });
  });

  describe('attachPolicyToRole / detachPolicyFromRole', () => {
    it('attaches a policy to a role', async () => {
      rolesRepo.findOne.mockResolvedValue({ id: 5, roleName: 'TEST_ROLE' });
      policiesRepo.findOne.mockResolvedValue({ id: 100, name: 'Test Policy' });
      rolePoliciesRepo.findOne.mockResolvedValue(null);

      await service.attachPolicyToRole(5, 100, 7);

      expect(rolePoliciesRepo.save).toHaveBeenCalledWith({ roleId: 5, policyId: 100 });
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ATTACH_POLICY' }));
    });

    it('attaching an already-attached policy is a no-op, not an error', async () => {
      rolesRepo.findOne.mockResolvedValue({ id: 5, roleName: 'TEST_ROLE' });
      policiesRepo.findOne.mockResolvedValue({ id: 100, name: 'Test Policy' });
      rolePoliciesRepo.findOne.mockResolvedValue({ id: 1, roleId: 5, policyId: 100 });

      await service.attachPolicyToRole(5, 100, 7);

      expect(rolePoliciesRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException attaching to a role that does not exist', async () => {
      rolesRepo.findOne.mockResolvedValue(null);
      await expect(service.attachPolicyToRole(999, 100, 7)).rejects.toThrow(NotFoundException);
    });

    it('detaches a policy from a role', async () => {
      rolePoliciesRepo.findOne.mockResolvedValue({ id: 1, roleId: 5, policyId: 100 });

      await service.detachPolicyFromRole(5, 100, 7);

      expect(rolePoliciesRepo.remove).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'DETACH_POLICY' }));
    });

    it('detaching an already-detached policy is a no-op, not an error', async () => {
      rolePoliciesRepo.findOne.mockResolvedValue(null);

      await service.detachPolicyFromRole(5, 100, 7);

      expect(rolePoliciesRepo.remove).not.toHaveBeenCalled();
    });

    it('refuses to detach any policy from the role named SUPER_ADMIN', async () => {
      rolePoliciesRepo.findOne.mockResolvedValue({ id: 1, roleId: 1, policyId: 100 });
      rolesRepo.findOne.mockResolvedValue({ id: 1, roleName: 'SUPER_ADMIN' });

      await expect(service.detachPolicyFromRole(1, 100, 7)).rejects.toThrow(/must always retain full access/);
      expect(rolePoliciesRepo.remove).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('still allows detaching from a role that is not SUPER_ADMIN', async () => {
      rolePoliciesRepo.findOne.mockResolvedValue({ id: 1, roleId: 5, policyId: 100 });
      rolesRepo.findOne.mockResolvedValue({ id: 5, roleName: 'OPERATIONS' });

      await service.detachPolicyFromRole(5, 100, 7);

      expect(rolePoliciesRepo.remove).toHaveBeenCalled();
    });

    it('allows attaching a system-managed policy to an ordinary (non-SUPER_ADMIN) role — isSystem never blocks attach', async () => {
      rolesRepo.findOne.mockResolvedValue({ id: 5, roleName: 'OPERATIONS' });
      policiesRepo.findOne.mockResolvedValue({ id: 66, name: 'SUPER_ADMIN Policy', isSystem: true });
      rolePoliciesRepo.findOne.mockResolvedValue(null);

      await service.attachPolicyToRole(5, 66, 7);

      expect(rolePoliciesRepo.save).toHaveBeenCalledWith({ roleId: 5, policyId: 66 });
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ATTACH_POLICY' }));
    });

    it('allows detaching a system-managed policy from an ordinary (non-SUPER_ADMIN) role it happens to be attached to', async () => {
      // isSystem protects the Policy's own name/description/statements (updatePolicy/removePolicy)
      // and its grant to the SUPER_ADMIN role specifically — it is NOT a blanket "can never be
      // detached from any role" rule. A system-managed policy attached to some other role (e.g. an
      // admin explicitly reused it there) can be detached from THAT role like any other policy.
      rolePoliciesRepo.findOne.mockResolvedValue({ id: 1, roleId: 5, policyId: 66 });
      rolesRepo.findOne.mockResolvedValue({ id: 5, roleName: 'OPERATIONS' });

      await service.detachPolicyFromRole(5, 66, 7);

      expect(rolePoliciesRepo.remove).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'DETACH_POLICY' }));
    });

    it('still refuses to detach a system-managed policy (or any policy) from SUPER_ADMIN specifically', async () => {
      rolePoliciesRepo.findOne.mockResolvedValue({ id: 1, roleId: 1, policyId: 66 });
      rolesRepo.findOne.mockResolvedValue({ id: 1, roleName: 'SUPER_ADMIN' });

      await expect(service.detachPolicyFromRole(1, 66, 7)).rejects.toThrow(ForbiddenException);
      await expect(service.detachPolicyFromRole(1, 66, 7)).rejects.toThrow(/must always retain full access/);
      expect(rolePoliciesRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('getActionCodesGrantedByPolicies / roleHasActionViaPolicy', () => {
    it('resolves the union of every attached policy statement action code', async () => {
      rolePoliciesRepo.find.mockResolvedValue([
        { policy: { statements: [{ effect: 'Allow', actions: ['VIEW_CUSTOMER'] }] } },
        { policy: { statements: [{ effect: 'Allow', actions: ['EDIT_CUSTOMER'] }] } },
      ]);

      const codes = await service.getActionCodesGrantedByPolicies(5);
      expect(codes).toEqual(new Set(['VIEW_CUSTOMER', 'EDIT_CUSTOMER']));
    });

    it('roleHasActionViaPolicy returns true only for a code actually in the resolved set', async () => {
      rolePoliciesRepo.find.mockResolvedValue([
        { policy: { statements: [{ effect: 'Allow', actions: ['VIEW_CUSTOMER'] }] } },
      ]);

      expect(await service.roleHasActionViaPolicy(5, 'VIEW_CUSTOMER')).toBe(true);
      expect(await service.roleHasActionViaPolicy(5, 'DELETE_CUSTOMER')).toBe(false);
    });
  });

  // The multi-role resolution every authorization read now goes through (see
  // getActionCodesGrantedByPoliciesForRoles's own doc comment): a user's effective permissions are the
  // purely ADDITIVE union, across ALL of their current roles, of every Allow statement's action codes.
  // These tests prove the semantics the multi-role migration promises — union, deny-by-default, nothing
  // that can subtract, no query for an empty role set — against a role_policies mock that answers
  // `find` the way the database would (only the rows whose roleId is in the requested set).
  describe('getActionCodesGrantedByPoliciesForRoles / rolesHaveActionViaPolicy — multi-role union', () => {
    type StatementRow = { effect: string; actions: string[] };
    type RolePolicyRow = { roleId: number; policy?: { statements?: StatementRow[] } };

    const allow = (...actions: string[]): StatementRow => ({ effect: 'Allow', actions });

    // roleId -> that role's attached policies' statements, one RolePolicy row per policy. `where.roleId`
    // is TypeORM's In(...) operator — at runtime its `.value` is the requested id array.
    function seedRolePolicies(rows: RolePolicyRow[]) {
      rolePoliciesRepo.find.mockImplementation(({ where }: { where: { roleId: { value: number[] } } }) =>
        Promise.resolve(rows.filter((row) => where.roleId.value.includes(row.roleId))),
      );
    }

    const FINANCE = 5;
    const OPERATIONS = 8;
    const NO_POLICY_ROLE = 20;

    const baseRows = (): RolePolicyRow[] => [
      { roleId: FINANCE, policy: { statements: [allow('VIEW_CUSTOMER', 'APPROVE_TARIFF')] } },
      { roleId: OPERATIONS, policy: { statements: [allow('EDIT_CUSTOMER'), allow('VIEW_CUSTOMER', 'VIEW_METER')] } },
    ];

    it('is the UNION of every Allow statement across every role — each code once, whichever role grants it', async () => {
      seedRolePolicies(baseRows());

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([FINANCE, OPERATIONS]);

      expect(codes).toEqual(new Set(['VIEW_CUSTOMER', 'APPROVE_TARIFF', 'EDIT_CUSTOMER', 'VIEW_METER']));
    });

    it('resolves the whole role set in ONE query (roleId IN (...)), loading each policy with its statements', async () => {
      seedRolePolicies(baseRows());

      await service.getActionCodesGrantedByPoliciesForRoles([FINANCE, OPERATIONS]);

      expect(rolePoliciesRepo.find).toHaveBeenCalledTimes(1);
      const options = rolePoliciesRepo.find.mock.calls[0][0];
      expect(options.where.roleId).toBeInstanceOf(FindOperator);
      expect(options.where.roleId.type).toBe('in');
      expect(options.where.roleId.value).toEqual([FINANCE, OPERATIONS]);
      expect(options.relations).toEqual({ policy: { statements: true } });
    });

    it('rolesHaveActionViaPolicy is true when ANY role grants the code, in either role order', async () => {
      seedRolePolicies(baseRows());

      expect(await service.rolesHaveActionViaPolicy([FINANCE, OPERATIONS], 'EDIT_CUSTOMER')).toBe(true); // only OPERATIONS grants it
      expect(await service.rolesHaveActionViaPolicy([OPERATIONS, FINANCE], 'APPROVE_TARIFF')).toBe(true); // only FINANCE grants it
      expect(await service.rolesHaveActionViaPolicy([FINANCE, OPERATIONS], 'DELETE_CUSTOMER')).toBe(false); // nobody grants it — deny by default
    });

    it('an EMPTY role set holds nothing and never queries', async () => {
      seedRolePolicies(baseRows());

      expect(await service.getActionCodesGrantedByPoliciesForRoles([])).toEqual(new Set());
      expect(await service.rolesHaveActionViaPolicy([], 'VIEW_CUSTOMER')).toBe(false);
      expect(rolePoliciesRepo.find).not.toHaveBeenCalled();
    });

    it('drops anything that is not a real role id — an all-invalid set holds nothing and never queries; a mixed set queries only the valid ids', async () => {
      seedRolePolicies(baseRows());

      const invalid = [undefined, null, NaN, 0, -3, 2.5] as unknown as number[];
      expect(await service.getActionCodesGrantedByPoliciesForRoles(invalid)).toEqual(new Set());
      expect(rolePoliciesRepo.find).not.toHaveBeenCalled();

      await service.getActionCodesGrantedByPoliciesForRoles([...invalid, FINANCE, FINANCE]);
      expect(rolePoliciesRepo.find).toHaveBeenCalledTimes(1);
      expect(rolePoliciesRepo.find.mock.calls[0][0].where.roleId.value).toEqual([FINANCE]); // de-duplicated too
    });

    it('a statement whose effect is not Allow contributes NOTHING', async () => {
      seedRolePolicies([
        { roleId: FINANCE, policy: { statements: [allow('VIEW_CUSTOMER'), { effect: 'Deny', actions: ['DELETE_CUSTOMER'] }] } },
      ]);

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([FINANCE]);

      expect(codes).toEqual(new Set(['VIEW_CUSTOMER']));
      expect(await service.rolesHaveActionViaPolicy([FINANCE], 'DELETE_CUSTOMER')).toBe(false);
    });

    it('a non-Allow statement on one role can never SUBTRACT a code another role grants (no Deny machinery exists)', async () => {
      seedRolePolicies([
        { roleId: FINANCE, policy: { statements: [allow('DELETE_CUSTOMER')] } },
        { roleId: OPERATIONS, policy: { statements: [{ effect: 'Deny', actions: ['DELETE_CUSTOMER'] }] } },
      ]);

      expect(await service.rolesHaveActionViaPolicy([FINANCE, OPERATIONS], 'DELETE_CUSTOMER')).toBe(true);
      expect(await service.rolesHaveActionViaPolicy([OPERATIONS, FINANCE], 'DELETE_CUSTOMER')).toBe(true);
    });

    it('a role WITHOUT grants never removes another role\'s grant — no policy at all, a policy with no statements, and an unloaded policy all contribute nothing', async () => {
      seedRolePolicies([
        ...baseRows(),
        { roleId: 30, policy: { statements: [] } },
        { roleId: 31, policy: undefined },
        // NO_POLICY_ROLE has no role_policies row whatsoever.
      ]);

      const alone = await service.getActionCodesGrantedByPoliciesForRoles([FINANCE]);
      const withGrantless = await service.getActionCodesGrantedByPoliciesForRoles([NO_POLICY_ROLE, 30, 31, FINANCE]);

      expect(withGrantless).toEqual(alone);
      expect(await service.rolesHaveActionViaPolicy([NO_POLICY_ROLE, FINANCE], 'VIEW_CUSTOMER')).toBe(true);
      expect(await service.rolesHaveActionViaPolicy([NO_POLICY_ROLE, 30, 31], 'VIEW_CUSTOMER')).toBe(false);
    });

    it('holding more roles can only ever ADD codes — every subset of roles resolves to exactly the union of its members, never less than any one member', async () => {
      seedRolePolicies([...baseRows(), { roleId: 9, policy: { statements: [allow('VIEW_COMMUNITY')] } }]);
      const roleIds = [FINANCE, OPERATIONS, 9];
      const single = new Map<number, Set<string>>();
      for (const id of roleIds) single.set(id, await service.getActionCodesGrantedByPoliciesForRoles([id]));

      const subsets: number[][] = [[FINANCE, OPERATIONS], [FINANCE, 9], [OPERATIONS, 9], [FINANCE, OPERATIONS, 9]];
      for (const subset of subsets) {
        const resolved = await service.getActionCodesGrantedByPoliciesForRoles(subset);
        const expectedUnion = new Set(subset.flatMap((id) => [...single.get(id)!]));
        expect(resolved).toEqual(expectedUnion);
        for (const id of subset) {
          for (const code of single.get(id)!) expect(resolved.has(code)).toBe(true);
        }
      }
    });

    it('the result does not depend on the order of the roles', async () => {
      seedRolePolicies(baseRows());

      expect(await service.getActionCodesGrantedByPoliciesForRoles([OPERATIONS, FINANCE])).toEqual(
        await service.getActionCodesGrantedByPoliciesForRoles([FINANCE, OPERATIONS]),
      );
    });

    describe('the single-role methods are thin wrappers over the multi-role resolution (ONE implementation)', () => {
      it('getActionCodesGrantedByPolicies(roleId) is exactly the multi-role result for [roleId], through the same In(...) query', async () => {
        seedRolePolicies(baseRows());

        const single = await service.getActionCodesGrantedByPolicies(FINANCE);
        const multi = await service.getActionCodesGrantedByPoliciesForRoles([FINANCE]);

        expect(single).toEqual(multi);
        expect(single).toEqual(new Set(['VIEW_CUSTOMER', 'APPROVE_TARIFF']));
        const [firstCall, secondCall] = rolePoliciesRepo.find.mock.calls;
        expect(firstCall[0].where.roleId.type).toBe('in');
        expect(firstCall[0].where.roleId.value).toEqual([FINANCE]);
        expect(secondCall[0]).toEqual(firstCall[0]);
      });

      it('roleHasActionViaPolicy(roleId, code) agrees with rolesHaveActionViaPolicy([roleId], code)', async () => {
        seedRolePolicies(baseRows());

        for (const code of ['VIEW_CUSTOMER', 'APPROVE_TARIFF', 'EDIT_CUSTOMER', 'DELETE_CUSTOMER']) {
          expect(await service.roleHasActionViaPolicy(FINANCE, code)).toBe(await service.rolesHaveActionViaPolicy([FINANCE], code));
        }
      });

      it('a MISSING role id never matches every role\'s policies — it resolves to no grants and never queries (the fail-open hazard of a bare where: { roleId })', async () => {
        seedRolePolicies(baseRows());

        expect(await service.getActionCodesGrantedByPolicies(undefined as unknown as number)).toEqual(new Set());
        expect(await service.roleHasActionViaPolicy(undefined as unknown as number, 'VIEW_CUSTOMER')).toBe(false);
        expect(rolePoliciesRepo.find).not.toHaveBeenCalled();
      });
    });
  });

  // A user's OWN inline policies are part of the same live union as their roles' policies: purely
  // additive, deny by default, never cached, and never another user's. The mock answers find the way
  // the database would (only the rows of the requested userId).
  describe('user inline policies join the same union (userId given)', () => {
    type InlineRow = { userId: number; statements: { effect: string; actions: string[] }[] };
    const allow = (...actions: string[]) => ({ effect: 'Allow', actions });

    let inlineRows: InlineRow[];
    beforeEach(() => {
      inlineRows = [];
      userInlinePoliciesRepo.find.mockImplementation(({ where }: { where: { userId: number } }) =>
        Promise.resolve(inlineRows.filter((row) => row.userId === where.userId)),
      );
      rolePoliciesRepo.find.mockImplementation(({ where }: { where: { roleId: { value: number[] } } }) =>
        Promise.resolve(
          [{ roleId: 5, policy: { statements: [allow('VIEW_CUSTOMER')] } }].filter((row) => where.roleId.value.includes(row.roleId)),
        ),
      );
    });

    it("is the union of the roles' grants AND the user's own inline grants", async () => {
      inlineRows = [{ userId: 42, statements: [allow('TARIFF_VIEW'), allow('VIEW_METER')] }];

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([5], 42);

      expect(codes).toEqual(new Set(['VIEW_CUSTOMER', 'TARIFF_VIEW', 'VIEW_METER']));
    });

    it("loads the user's inline policies by userId with their statements — one extra query, alongside the role query", async () => {
      inlineRows = [{ userId: 42, statements: [allow('TARIFF_VIEW')] }];

      await service.getActionCodesGrantedByPoliciesForRoles([5], 42);

      expect(userInlinePoliciesRepo.find).toHaveBeenCalledTimes(1);
      expect(userInlinePoliciesRepo.find).toHaveBeenCalledWith({ where: { userId: 42 }, relations: { statements: true } });
      expect(rolePoliciesRepo.find).toHaveBeenCalledTimes(1);
    });

    it('an inline grant alone is enough — rolesHaveActionViaPolicy is true with no role granting the code', async () => {
      inlineRows = [{ userId: 42, statements: [allow('TARIFF_VIEW')] }];

      expect(await service.rolesHaveActionViaPolicy([5], 'TARIFF_VIEW', 42)).toBe(true);
      expect(await service.rolesHaveActionViaPolicy([5], 'DELETE_CUSTOMER', 42)).toBe(false); // nothing grants it — deny by default
    });

    it("never includes ANOTHER user's inline policies", async () => {
      inlineRows = [{ userId: 43, statements: [allow('TARIFF_VIEW')] }];

      expect(await service.rolesHaveActionViaPolicy([5], 'TARIFF_VIEW', 42)).toBe(false);
    });

    it('without a userId the inline policies are never read — a role-only question is answered by roles alone', async () => {
      inlineRows = [{ userId: 42, statements: [allow('TARIFF_VIEW')] }];

      expect(await service.rolesHaveActionViaPolicy([5], 'TARIFF_VIEW')).toBe(false);
      expect(userInlinePoliciesRepo.find).not.toHaveBeenCalled();
    });

    it.each([[undefined], [null], [NaN], [0], [-1], [1.5]])('an invalid userId (%p) never queries the inline policies', async (invalid) => {
      inlineRows = [{ userId: 42, statements: [allow('TARIFF_VIEW')] }];

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([5], invalid as unknown as number);

      expect(userInlinePoliciesRepo.find).not.toHaveBeenCalled();
      expect(codes).toEqual(new Set(['VIEW_CUSTOMER']));
    });

    it('a user with inline policies but NO roles resolves only the inline grants, without touching role_policies', async () => {
      inlineRows = [{ userId: 42, statements: [allow('TARIFF_VIEW')] }];

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([], 42);

      expect(codes).toEqual(new Set(['TARIFF_VIEW']));
      expect(rolePoliciesRepo.find).not.toHaveBeenCalled();
    });

    it('no roles and no user holds nothing and queries nothing', async () => {
      expect(await service.getActionCodesGrantedByPoliciesForRoles([], undefined)).toEqual(new Set());
      expect(rolePoliciesRepo.find).not.toHaveBeenCalled();
      expect(userInlinePoliciesRepo.find).not.toHaveBeenCalled();
    });

    it('a statement whose effect is not Allow contributes NOTHING — it can neither grant nor subtract', async () => {
      inlineRows = [{ userId: 42, statements: [{ effect: 'Deny', actions: ['VIEW_CUSTOMER', 'TARIFF_VIEW'] }, allow('VIEW_METER')] }];

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([5], 42);

      expect(codes).toEqual(new Set(['VIEW_CUSTOMER', 'VIEW_METER'])); // VIEW_CUSTOMER still comes from the role
    });

    it('is never cached — deleting an inline policy revokes its grants on the very next resolution', async () => {
      inlineRows = [{ userId: 42, statements: [allow('TARIFF_VIEW')] }];
      expect(await service.rolesHaveActionViaPolicy([5], 'TARIFF_VIEW', 42)).toBe(true);

      inlineRows = []; // the policy is deleted

      expect(await service.rolesHaveActionViaPolicy([5], 'TARIFF_VIEW', 42)).toBe(false);
      expect(userInlinePoliciesRepo.find).toHaveBeenCalledTimes(2);
    });
  });

  // Confirms the SUPER_ADMIN/ADMIN Policy-sync fix found during the RBAC naming audit: real
  // authorization resolves exclusively through Policies (roleHasActionViaPolicy above), so an admin
  // role's Policy must be kept in sync with the active Resource/Action catalog the same way
  // RolePermissionsService.ensureAdminGrants keeps the legacy tree in sync — otherwise an action
  // added after the one-time IAM backfill migration is silently unusable by the admin role.
  describe('ensureAdminPolicyGrants', () => {
    const USER_RESOURCE = { id: 20, code: 'USER' };
    const VIEW_USER_ACTION = { id: 30, code: 'VIEW_USER', isActive: true };
    const CREATE_USER_ACTION = { id: 31, code: 'CREATE_USER', isActive: true };
    const EDIT_USER_ACTION = { id: 32, code: 'EDIT_USER', isActive: true };
    const DELETE_USER_ACTION = { id: 33, code: 'DELETE_USER', isActive: true };

    it('does nothing when no SUPER_ADMIN/ADMIN role exists', async () => {
      rolesRepo.find.mockResolvedValue([]);

      await service.ensureAdminPolicyGrants([]);

      expect(rolePoliciesRepo.find).not.toHaveBeenCalled();
    });

    // The fresh-install path: migrations (AddIamPolicyBackfill) run before bootstrap's seed() has
    // created any Role/RolePermission rows, so that migration finds nothing to back-fill and
    // SUPER_ADMIN reaches this method with zero attached Policies. It must not be left ungranted.
    it('creates the role\'s own Policy and attaches it when none exists yet, then grants every active, non-excluded action (fresh-install path)', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION, CREATE_USER_ACTION]);
      policiesRepo.findOne.mockResolvedValue(null);

      // First read: zero attached Policies. Every read after the create+attach below returns this
      // SAME object, mutated in place as statements get saved — same established pattern as the
      // "creates a brand-new statement" test above, so the self-check's own re-read reflects it too.
      const createdPolicy: { id: number; statements: { resourceId: number; effect: string; actions: string[] }[] } = {
        id: 100,
        statements: [],
      };
      rolePoliciesRepo.find.mockResolvedValueOnce([]).mockResolvedValue([{ policy: createdPolicy }]);

      statementsRepo.create.mockImplementation((data: any) => data);
      statementsRepo.save.mockImplementation((s: any) => {
        createdPolicy.statements.push({ ...s, effect: 'Allow' });
        return Promise.resolve(s);
      });

      await service.ensureAdminPolicyGrants([]);

      expect(policiesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'SUPER_ADMIN Policy' }));
      expect(rolePoliciesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ roleId: 2, policyId: 100 }));
      expect(createdPolicy.statements).toEqual([
        expect.objectContaining({
          resourceId: USER_RESOURCE.id,
          actions: expect.arrayContaining(['VIEW_USER', 'CREATE_USER']),
        }),
      ]);
    });

    it('reuses an existing Policy by the expected name instead of failing on the unique-name constraint, if one is already there but unattached', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION]);

      const preExistingPolicy: { id: number; isSystem: boolean; statements: { resourceId: number; effect: string; actions: string[] }[] } = {
        id: 77,
        isSystem: true,
        statements: [],
      };
      policiesRepo.findOne.mockResolvedValue(preExistingPolicy);
      rolePoliciesRepo.find.mockResolvedValueOnce([]).mockResolvedValue([{ policy: preExistingPolicy }]);
      statementsRepo.create.mockImplementation((data: any) => data);
      statementsRepo.save.mockImplementation((s: any) => {
        preExistingPolicy.statements.push({ ...s, effect: 'Allow' });
        return Promise.resolve(s);
      });

      await service.ensureAdminPolicyGrants([]);

      expect(policiesRepo.save).not.toHaveBeenCalled();
      expect(rolePoliciesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ roleId: 2, policyId: 77 }));
    });

    it("adds every missing active, non-excluded action to the role's existing statement for that resource", async () => {
      rolesRepo.find.mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION, CREATE_USER_ACTION, EDIT_USER_ACTION, DELETE_USER_ACTION]);

      const sharedStatement = { resourceId: USER_RESOURCE.id, effect: 'Allow', actions: ['VIEW_USER'] };
      rolePoliciesRepo.find.mockResolvedValue([{ policy: { id: 2, statements: [sharedStatement] } }]);
      statementsRepo.save.mockImplementation((s: any) => Promise.resolve(s));

      await service.ensureAdminPolicyGrants([]);

      expect(statementsRepo.save).toHaveBeenCalledTimes(1);
      expect([...sharedStatement.actions].sort()).toEqual(['CREATE_USER', 'DELETE_USER', 'EDIT_USER', 'VIEW_USER']);
    });

    it('creates a brand-new statement for a resource the policy has no statement for at all', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION]);

      const sharedPolicy: { id: number; statements: { resourceId: number; actions: string[] }[] } = { id: 2, statements: [] };
      rolePoliciesRepo.find.mockResolvedValue([{ policy: sharedPolicy }]);
      statementsRepo.create.mockImplementation((data: any) => data);
      statementsRepo.save.mockImplementation((s: any) => {
        sharedPolicy.statements.push(s);
        return Promise.resolve(s);
      });

      await service.ensureAdminPolicyGrants([]);

      expect(statementsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ policyId: 2, resourceId: USER_RESOURCE.id, effect: 'Allow', actions: ['VIEW_USER'] }),
      );
    });

    // A role can have more than one Policy attached (AttachPolicyDto allows it). If a SECOND attached
    // Policy already grants an action for a resource, the primary (first) Policy must not get a
    // redundant grant of its own for that same code — otherwise every boot would keep adding the same
    // already-covered action into the primary Policy's statement, growing it forever and scattering
    // the same grant across multiple Policies.
    it('does not redundantly re-grant an action into the primary Policy when a SECOND attached Policy already covers it', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION, CREATE_USER_ACTION]);

      const primaryStatement = { resourceId: USER_RESOURCE.id, effect: 'Allow', actions: ['VIEW_USER'] };
      const secondaryStatement = { resourceId: USER_RESOURCE.id, effect: 'Allow', actions: ['CREATE_USER'] };
      rolePoliciesRepo.find.mockResolvedValue([
        { policy: { id: 2, statements: [primaryStatement] } },
        { policy: { id: 9, statements: [secondaryStatement] } },
      ]);

      await service.ensureAdminPolicyGrants([]);

      expect(statementsRepo.save).not.toHaveBeenCalled();
      expect(primaryStatement.actions).toEqual(['VIEW_USER']);
      expect(secondaryStatement.actions).toEqual(['CREATE_USER']);
    });

    // SUPER_ADMIN is the application's root/owner account per explicit business requirement: it is
    // NEVER subject to excludedActionCodesForAdmin, full stop. Only a distinct ADMIN role still has
    // it applied — this is the "remove the exclusion from SUPER_ADMIN, keep it for ADMIN" business
    // decision (not a guess), proven directly rather than merely asserted.
    it('SUPER_ADMIN is never subject to excludedActionCodesForAdmin — it gets every active action regardless', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION, DELETE_USER_ACTION]);

      const sharedStatement = { resourceId: USER_RESOURCE.id, effect: 'Allow', actions: ['VIEW_USER'] };
      rolePoliciesRepo.find.mockResolvedValue([{ policy: { id: 2, statements: [sharedStatement] } }]);
      statementsRepo.save.mockImplementation((s: any) => Promise.resolve(s));

      await service.ensureAdminPolicyGrants(['DELETE_USER']);

      expect(sharedStatement.actions).toEqual(expect.arrayContaining(['VIEW_USER', 'DELETE_USER']));
    });

    it('ADMIN (a distinct role from SUPER_ADMIN) still has excludedActionCodesForAdmin applied — never auto-granted an excluded code', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 9, roleName: 'ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION, DELETE_USER_ACTION]);

      const sharedStatement = { resourceId: USER_RESOURCE.id, effect: 'Allow', actions: ['VIEW_USER'] };
      rolePoliciesRepo.find.mockResolvedValue([{ policy: { id: 2, statements: [sharedStatement] } }]);
      statementsRepo.save.mockImplementation((s: any) => Promise.resolve(s));

      await service.ensureAdminPolicyGrants(['DELETE_USER']);

      expect(sharedStatement.actions).toEqual(['VIEW_USER']);
      expect(statementsRepo.save).not.toHaveBeenCalled();
    });

    it('a manually-granted excluded code already on ADMIN\'s Policy is preserved (never auto-revoked), while new auto-grants of it stay withheld', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 9, roleName: 'ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION, CREATE_USER_ACTION, DELETE_USER_ACTION]);

      // ADMIN already holds DELETE_USER (excluded) via a manual grant, plus VIEW_USER — CREATE_USER
      // is still missing and should be added normally.
      const sharedStatement = { resourceId: USER_RESOURCE.id, effect: 'Allow', actions: ['VIEW_USER', 'DELETE_USER'] };
      rolePoliciesRepo.find.mockResolvedValue([{ policy: { id: 2, statements: [sharedStatement] } }]);
      statementsRepo.save.mockImplementation((s: any) => Promise.resolve(s));

      await service.ensureAdminPolicyGrants(['DELETE_USER']);

      expect(sharedStatement.actions).toEqual(expect.arrayContaining(['VIEW_USER', 'DELETE_USER', 'CREATE_USER']));
    });

    it('throws if the post-write self-check still finds a missing code, instead of reporting false success', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION, CREATE_USER_ACTION]);
      statementsRepo.save.mockResolvedValue(undefined);

      // Two independent object literals (not shared references) — the self-check's own re-read must
      // reflect what a FRESH query would return, not the in-memory mutation this method already made
      // to the first object, so a save that silently failed to persist is still caught.
      rolePoliciesRepo.find
        .mockResolvedValueOnce([{ policy: { id: 2, statements: [{ resourceId: USER_RESOURCE.id, effect: 'Allow', actions: ['VIEW_USER'] }] } }])
        .mockResolvedValueOnce([{ policy: { statements: [{ resourceId: USER_RESOURCE.id, effect: 'Allow', actions: ['VIEW_USER'] }] } }]);

      await expect(service.ensureAdminPolicyGrants([])).rejects.toThrow(/still missing/);
    });

    it('never grants an action that exists in the Resource catalog but is not currently active (retired)', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      // DELETE_USER_ACTION omitted entirely from the "active" set — simulating retirement the same
      // way a real retired action is excluded from ActionsService.ensureCriticalDefaults' own
      // isActive:true query, so it can never again be granted via this method either.
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION, CREATE_USER_ACTION, EDIT_USER_ACTION]);

      const sharedStatement = { resourceId: USER_RESOURCE.id, effect: 'Allow', actions: [] as string[] };
      rolePoliciesRepo.find.mockResolvedValue([{ policy: { id: 2, statements: [sharedStatement] } }]);
      statementsRepo.save.mockImplementation((s: any) => Promise.resolve(s));

      await service.ensureAdminPolicyGrants([]);

      expect(sharedStatement.actions).toEqual(expect.arrayContaining(['VIEW_USER', 'CREATE_USER', 'EDIT_USER']));
      expect(sharedStatement.actions).not.toContain('DELETE_USER');
    });

    it('is idempotent across repeated boots — a second run makes no further Policy/statement writes once fully synced', async () => {
      rolesRepo.find.mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]);
      resourcesRepo.find.mockResolvedValue([USER_RESOURCE]);
      actionsRepo.find.mockResolvedValue([VIEW_USER_ACTION, CREATE_USER_ACTION]);
      policiesRepo.findOne.mockResolvedValue(null);

      // isSystem: true from the start — mirrors the real create() call, which already passes
      // isSystem: isSuperAdminRole at creation time (see ensureAdminPolicyGrants's fresh-install
      // branch), so a later re-read on the second boot below never finds it unset and never fires
      // the separate backfill-safety-net save that branch has for an ALREADY-EXISTING, unflagged row.
      const createdPolicy: { id: number; isSystem: boolean; statements: { resourceId: number; effect: string; actions: string[] }[] } = {
        id: 100,
        isSystem: true,
        statements: [],
      };
      // Consumed once (the very first read, before anything exists); every later read — within this
      // first boot's own self-check AND the second boot entirely — returns the same, now-populated
      // policy, exactly like a real re-read from the database would after the first boot committed.
      rolePoliciesRepo.find.mockResolvedValueOnce([]).mockResolvedValue([{ policy: createdPolicy }]);
      statementsRepo.create.mockImplementation((data: any) => data);
      statementsRepo.save.mockImplementation((s: any) => {
        const existing = createdPolicy.statements.find((st) => st.resourceId === s.resourceId);
        if (existing) existing.actions = s.actions;
        else createdPolicy.statements.push({ ...s, effect: 'Allow' });
        return Promise.resolve(s);
      });

      await service.ensureAdminPolicyGrants([]);
      expect(policiesRepo.save).toHaveBeenCalledTimes(1);
      const statementSavesAfterFirstBoot = statementsRepo.save.mock.calls.length;

      policiesRepo.save.mockClear();
      await service.ensureAdminPolicyGrants([]);

      expect(policiesRepo.save).not.toHaveBeenCalled();
      expect(statementsRepo.save.mock.calls.length).toBe(statementSavesAfterFirstBoot);
      expect(createdPolicy.statements).toHaveLength(1);
      expect([...createdPolicy.statements[0].actions].sort()).toEqual(['CREATE_USER', 'VIEW_USER']);
    });

    // Not a toy subset — proves comprehensive coverage against the REAL resource-catalog.ts and
    // seed-data.ts ACTIONS/ADMIN_GRANT_EXCLUDED_ACTION_CODES, the same data the real boot sequence
    // uses. BILL_RUN_HISTORICAL_SUBMIT/APPROVE are deliberately excluded from `expectedGranted` — per
    // resource-catalog.ts's own comment they are pre-provisioned-but-unimplemented codes intentionally
    // absent from seed-data.ts's ACTIONS array (so a role with no historical grant of its own
    // correctly never gets them from this method; a role that already holds them keeps them,
    // untouched, since this method only ever adds, never removes).
    //
    // Covers both roles in one pass since they share the exact same catalog mocks and must diverge
    // only on the exclusion list: SUPER_ADMIN gets every single active code including the ones in
    // ADMIN_GRANT_EXCLUDED_ACTION_CODES (Finance/Billing/Tariff approvals, workflow-approver
    // management); ADMIN still has that list withheld.
    it('comprehensive, against the REAL catalog: SUPER_ADMIN gets every active action with NO exclusions; ADMIN still has ADMIN_GRANT_EXCLUDED_ACTION_CODES withheld', async () => {
      const realActionCodes = new Set(ACTIONS.map((a) => a.code));
      const excluded = new Set(ADMIN_GRANT_EXCLUDED_ACTION_CODES);
      const allActiveActionRows = ACTIONS.map((a, i) => ({ id: i + 1, code: a.code, isActive: true }));
      const allResourceRows = RESOURCES.map((r, i) => ({ id: i + 1, code: r.code }));
      const expectedActiveGrantable = RESOURCES.flatMap((r) => r.actionCodes).filter((code) => realActionCodes.has(code));

      // --- SUPER_ADMIN: fresh install, gets everything, excluded codes included ---
      rolesRepo.find.mockResolvedValue([{ id: 2, roleName: 'SUPER_ADMIN' }]);
      resourcesRepo.find.mockResolvedValue(allResourceRows);
      actionsRepo.find.mockResolvedValue(allActiveActionRows);
      policiesRepo.findOne.mockResolvedValue(null);

      const superAdminPolicy: { id: number; statements: { resourceId: number; effect: string; actions: string[] }[] } = {
        id: 100,
        statements: [],
      };
      rolePoliciesRepo.find.mockResolvedValueOnce([]).mockResolvedValue([{ policy: superAdminPolicy }]);
      statementsRepo.create.mockImplementation((data: any) => data);
      statementsRepo.save.mockImplementation((s: any) => {
        superAdminPolicy.statements.push({ ...s, effect: 'Allow' });
        return Promise.resolve(s);
      });

      await service.ensureAdminPolicyGrants(ADMIN_GRANT_EXCLUDED_ACTION_CODES);

      const superAdminGranted = new Set(superAdminPolicy.statements.flatMap((s) => s.actions));
      for (const code of expectedActiveGrantable) {
        expect(superAdminGranted.has(code)).toBe(true);
      }
      for (const code of excluded) {
        expect(superAdminGranted.has(code)).toBe(true); // explicitly NOT withheld for SUPER_ADMIN
      }

      // --- ADMIN: same catalog, same exclusion list argument, but the list still applies ---
      rolesRepo.find.mockResolvedValue([{ id: 9, roleName: 'ADMIN' }]);
      const adminPolicy: { id: number; statements: { resourceId: number; effect: string; actions: string[] }[] } = {
        id: 101,
        statements: [],
      };
      rolePoliciesRepo.find.mockReset();
      rolePoliciesRepo.find.mockResolvedValueOnce([]).mockResolvedValue([{ policy: adminPolicy }]);
      statementsRepo.save.mockImplementation((s: any) => {
        adminPolicy.statements.push({ ...s, effect: 'Allow' });
        return Promise.resolve(s);
      });

      await service.ensureAdminPolicyGrants(ADMIN_GRANT_EXCLUDED_ACTION_CODES);

      const adminGranted = new Set(adminPolicy.statements.flatMap((s) => s.actions));
      const expectedForAdmin = expectedActiveGrantable.filter((code) => !excluded.has(code));
      for (const code of expectedForAdmin) {
        expect(adminGranted.has(code)).toBe(true);
      }
      for (const code of excluded) {
        expect(adminGranted.has(code)).toBe(false);
      }
    });
  });
});
