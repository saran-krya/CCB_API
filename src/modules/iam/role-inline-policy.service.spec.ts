import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RoleInlinePolicyService } from './role-inline-policy.service';
import { RoleInlinePolicy } from './entities/role-inline-policy.entity';
import { RoleInlinePolicyStatement } from './entities/role-inline-policy-statement.entity';
import { Role } from '../role/entities/role.entity';
import { UserRole } from '../user-role/entities/user-role.entity';
import { IamService } from './iam.service';
import { AuditService } from '../../audit/audit.service';

// What a role's inline policy may NOT do to the business-approval rule: hand SUPER_ADMIN an approval, or silently
// strand the role that is the configured approver of an active workflow level. The checks themselves live in
// IamService (iam-business-approval.spec.ts); here: this service calls them at the right moment, inside the right
// transaction, and a refusal leaves nothing written.
describe('RoleInlinePolicyService — business-approval guards', () => {
  const ROLE = 6;
  const ACTOR = 9;
  const DTO = { name: 'Tariff team', description: 'd', statements: [{ resourceCode: 'TARIFF', actionCodes: ['TARIFF_VIEW'] }] };

  let service: RoleInlinePolicyService;
  let policiesRepo: { findOne: jest.Mock; findOneOrFail: jest.Mock; save: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  let statementsRepo: { save: jest.Mock; create: jest.Mock; delete: jest.Mock };
  let iam: { validateStatements: jest.Mock; assertNoBusinessApprovalForSuperAdmin: jest.Mock; assertApproverEligibilityKept: jest.Mock };
  let audit: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let manager: { getRepository: jest.Mock };

  const EXISTING = {
    id: 100,
    roleId: ROLE,
    name: 'Tariff team',
    description: 'old',
    statements: [{ id: 1, resource: { code: 'TARIFF' }, actions: ['TARIFF_VIEW', 'TARIFF_APPROVE'] }],
  };

  beforeEach(async () => {
    policiesRepo = {
      findOne: jest.fn().mockImplementation(({ where }: { where: { name?: string } }) => Promise.resolve(where.name !== undefined ? null : EXISTING)),
      findOneOrFail: jest.fn().mockResolvedValue(EXISTING),
      save: jest.fn().mockImplementation((p) => Promise.resolve({ id: 100, ...p })),
      create: jest.fn((data) => data),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    statementsRepo = { save: jest.fn().mockResolvedValue(undefined), create: jest.fn((data) => data), delete: jest.fn().mockResolvedValue({ affected: 1 }) };
    iam = {
      validateStatements: jest.fn().mockResolvedValue([{ resourceId: 10, actions: ['TARIFF_VIEW'] }]),
      assertNoBusinessApprovalForSuperAdmin: jest.fn().mockResolvedValue(undefined),
      assertApproverEligibilityKept: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === RoleInlinePolicy) return policiesRepo;
        if (entity === RoleInlinePolicyStatement) return statementsRepo;
        return {};
      }),
    };
    dataSource = { transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoleInlinePolicyService,
        { provide: getRepositoryToken(RoleInlinePolicy), useValue: policiesRepo },
        { provide: getRepositoryToken(Role), useValue: { findOne: jest.fn().mockResolvedValue({ id: ROLE }) } },
        { provide: getRepositoryToken(UserRole), useValue: { findOne: jest.fn().mockResolvedValue(null) } },
        { provide: IamService, useValue: iam },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(RoleInlinePolicyService);
  });

  describe('create', () => {
    it("asks whether the grant would land on SUPER_ADMIN (the role is the owner) and, when refused, writes nothing", async () => {
      iam.validateStatements.mockResolvedValue([{ resourceId: 10, actions: ['TARIFF_APPROVE'] }]);
      iam.assertNoBusinessApprovalForSuperAdmin.mockRejectedValue(new BadRequestException('SUPER_ADMIN is a system-administration role'));

      await expect(service.create(ROLE, DTO, ACTOR)).rejects.toThrow(BadRequestException);

      expect(iam.assertNoBusinessApprovalForSuperAdmin).toHaveBeenCalledWith(['TARIFF_APPROVE'], { roleIds: [ROLE] });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(policiesRepo.save).not.toHaveBeenCalled();
    });

    it('saves normally when the guard allows it', async () => {
      await service.create(ROLE, DTO, ACTOR);

      expect(statementsRepo.save).toHaveBeenCalledWith([{ policyId: 100, resourceId: 10, effect: 'Allow', actions: ['TARIFF_VIEW'] }]);
    });
  });

  describe('update', () => {
    it('is refused, before any write, when the new statements would give SUPER_ADMIN an approval', async () => {
      iam.assertNoBusinessApprovalForSuperAdmin.mockRejectedValue(new BadRequestException('SUPER_ADMIN is a system-administration role'));

      await expect(service.update(ROLE, 100, DTO, ACTOR)).rejects.toThrow(BadRequestException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('checks, INSIDE the editing transaction, that no configured approver loses a code the edit removes', async () => {
      await service.update(ROLE, 100, DTO, ACTOR); // old: TARIFF_VIEW + TARIFF_APPROVE, new: TARIFF_VIEW

      expect(iam.assertApproverEligibilityKept).toHaveBeenCalledWith(manager, [ROLE], ['TARIFF_APPROVE'], 'This inline policy edit');
      // after the statements were replaced, before the audit row
      expect(statementsRepo.save.mock.invocationCallOrder[0]).toBeLessThan(iam.assertApproverEligibilityKept.mock.invocationCallOrder[0]);
      expect(iam.assertApproverEligibilityKept.mock.invocationCallOrder[0]).toBeLessThan(audit.record.mock.invocationCallOrder[0]);
    });

    it('a 409 from that check aborts the edit before it is audited (the transaction rolls back)', async () => {
      iam.assertApproverEligibilityKept.mockRejectedValue(new ConflictException('would strand an approver'));

      await expect(service.update(ROLE, 100, DTO, ACTOR)).rejects.toThrow(ConflictException);

      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('checks, inside the transaction and after the delete, that no configured approver loses the policy\'s codes', async () => {
      await service.remove(ROLE, 100, ACTOR);

      expect(iam.assertApproverEligibilityKept).toHaveBeenCalledWith(manager, [ROLE], ['TARIFF_VIEW', 'TARIFF_APPROVE'], 'Deleting this inline policy');
      expect(policiesRepo.delete.mock.invocationCallOrder[0]).toBeLessThan(iam.assertApproverEligibilityKept.mock.invocationCallOrder[0]);
    });

    it('a 409 from that check aborts the delete before it is audited', async () => {
      iam.assertApproverEligibilityKept.mockRejectedValue(new ConflictException('would strand an approver'));

      await expect(service.remove(ROLE, 100, ACTOR)).rejects.toThrow(ConflictException);

      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
