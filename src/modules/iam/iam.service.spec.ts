import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IamService } from './iam.service';
import { Resource } from './entities/resource.entity';
import { Policy } from './entities/policy.entity';
import { PolicyStatement } from './entities/policy-statement.entity';
import { RolePolicy } from './entities/role-policy.entity';
import { Role } from '../role/entities/role.entity';
import { Action } from '../actions/entities/action.entity';
import { AuditService } from '../../audit/audit.service';

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
  let rolesRepo: { findOne: jest.Mock };
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
    rolesRepo = { findOne: jest.fn() };
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
});
