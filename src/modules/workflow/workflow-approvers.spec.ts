import { BadRequestException, ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { In } from 'typeorm';
import { assertNotSelfReview } from '../../common/utils/versioning.util';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowOrchestrationService } from './workflow-orchestration.service';
import { WorkflowService } from './workflow.service';
import { WorkflowType } from './dto/workflow.dto';
import { WorkflowDefinitionStatus } from './entities/workflow-definition.entity';
import { WorkflowInstanceStatus } from './entities/workflow-instance.entity';
import { WorkflowOnBreach, WorkflowSlaUnit } from './entities/workflow-approval-level.entity';

// Who may be a workflow approver, and who may act at a level. Eligibility is decided by the SAME policy-based
// predicate (RolePermissionsService.getRoleIdsHoldingAnyAction -> IamService) for the Approver Role dropdown and for
// the save-time check, so the screen can never offer a role the backend refuses. SUPER_ADMIN is never an approver.
describe('workflow approvers', () => {
  const SUPER_ADMIN = 1;
  const FINANCE = 2;
  const OPERATIONS = 3;
  const ROLE_ROWS = [
    { id: SUPER_ADMIN, roleName: 'SUPER_ADMIN' },
    { id: FINANCE, roleName: 'FINANCE' },
    { id: OPERATIONS, roleName: 'OPERATIONS' },
  ];

  const level = (roleId: number, overrides: Record<string, unknown> = {}) => ({
    roleId,
    department: null,
    slaValue: 2,
    slaUnit: WorkflowSlaUnit.CALENDAR_DAYS,
    onBreach: WorkflowOnBreach.NOTIFY,
    ...overrides,
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('WorkflowDefinitionService', () => {
    let eligibleIds: number[];
    let rolePermissions: { getRoleIdsHoldingAnyAction: jest.Mock };
    let rolesRepo: { find: jest.Mock };
    let definitionsRepo: { findOne: jest.Mock; find: jest.Mock };
    let levelsRepo: { find: jest.Mock };
    let txDefinitions: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock; createQueryBuilder: jest.Mock };
    let txLevels: { save: jest.Mock; create: jest.Mock };
    let dataSource: { transaction: jest.Mock };
    let service: WorkflowDefinitionService;

    beforeEach(() => {
      eligibleIds = [FINANCE];
      rolePermissions = { getRoleIdsHoldingAnyAction: jest.fn().mockImplementation(() => Promise.resolve([...eligibleIds])) };
      rolesRepo = {
        find: jest.fn().mockImplementation(({ where }: { where?: { id?: { value: number[] } } } = {}) =>
          Promise.resolve(ROLE_ROWS.filter((r) => (where?.id ? where.id.value.includes(r.id) : true))),
        ),
      };
      definitionsRepo = { findOne: jest.fn().mockResolvedValue({ id: 50, version: 4, status: WorkflowDefinitionStatus.ACTIVE }), find: jest.fn() };
      levelsRepo = { find: jest.fn().mockResolvedValue([]) };
      txDefinitions = {
        findOne: jest.fn().mockResolvedValue({ id: 50, version: 4, status: WorkflowDefinitionStatus.ACTIVE }),
        save: jest.fn().mockImplementation((d) => Promise.resolve({ id: 51, ...d })),
        create: jest.fn((d) => d),
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValue({ max: 4 }),
        })),
      };
      txLevels = { save: jest.fn().mockResolvedValue(undefined), create: jest.fn((l) => l) };
      const manager = { getRepository: jest.fn((entity: { name: string }) => (entity.name === 'WorkflowDefinition' ? txDefinitions : txLevels)) };
      dataSource = { transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)) };
      service = new WorkflowDefinitionService(
        dataSource as never,
        definitionsRepo as never,
        levelsRepo as never,
        rolesRepo as never,
        rolePermissions as never,
      );
    });

    describe('the Approver Role dropdown (getEligibleApproverRoles)', () => {
      it('lists exactly the roles whose POLICIES grant the approve code — resolved by id, ordered by name, never from role_permissions', async () => {
        eligibleIds = [FINANCE, OPERATIONS];

        const result = await service.getEligibleApproverRoles(WorkflowType.TARIFF);

        expect(rolePermissions.getRoleIdsHoldingAnyAction).toHaveBeenCalledWith(['TARIFF_APPROVE']);
        expect(rolesRepo.find).toHaveBeenCalledWith({ where: { id: In([FINANCE, OPERATIONS]) }, order: { roleName: 'ASC' } });
        expect(result).toEqual({
          workflowType: 'TARIFF',
          roles: [
            { id: FINANCE, roleName: 'FINANCE' },
            { id: OPERATIONS, roleName: 'OPERATIONS' },
          ],
        });
      });

      it('asks for each workflow type its own approve code', async () => {
        await service.getEligibleApproverRoles(WorkflowType.BILL_RUN);
        await service.getEligibleApproverRoles(WorkflowType.BILLING_CYCLE);

        expect(rolePermissions.getRoleIdsHoldingAnyAction.mock.calls).toEqual([[['BILL_RUN_APPROVE']], [['BILLING_CYCLE_APPROVE']]]);
      });

      it('is empty — without loading any role — when nobody holds the code', async () => {
        eligibleIds = [];

        expect(await service.getEligibleApproverRoles(WorkflowType.TARIFF)).toEqual({ workflowType: 'TARIFF', roles: [] });
        expect(rolesRepo.find).not.toHaveBeenCalled();
      });

      it('refuses an unsupported workflow type', async () => {
        await expect(service.getEligibleApproverRoles('NOPE' as WorkflowType)).rejects.toThrow(BadRequestException);
      });

      it('follows a policy revocation on the very next call', async () => {
        expect((await service.getEligibleApproverRoles(WorkflowType.TARIFF)).roles).toHaveLength(1);

        eligibleIds = []; // the approve permission was taken away from FINANCE

        expect((await service.getEligibleApproverRoles(WorkflowType.TARIFF)).roles).toEqual([]);
      });
    });

    describe('saving a definition (publishNewVersion) — the backend check behind that dropdown', () => {
      it('REFUSES SUPER_ADMIN as an approver, by name, even if the eligibility predicate were to list it', async () => {
        eligibleIds = [SUPER_ADMIN, FINANCE];

        await expect(service.publishNewVersion(WorkflowType.TARIFF, { levels: [level(SUPER_ADMIN)] }, 9)).rejects.toThrow(
          'Level 1: SUPER_ADMIN is a system-administration role and cannot be a workflow approver',
        );

        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('refuses a role that does not hold the approve permission, naming the level, the role and the workflow', async () => {
        await expect(service.publishNewVersion(WorkflowType.BILL_RUN, { levels: [level(OPERATIONS)] }, 9)).rejects.toThrow(
          'Level 1: role "OPERATIONS" does not currently hold the real approve permission for BILL_RUN',
        );

        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('refuses an unknown role id', async () => {
        await expect(service.publishNewVersion(WorkflowType.TARIFF, { levels: [level(999)] }, 9)).rejects.toThrow('Level 1: unknown approver role "999"');
      });

      it('reports every problem of the whole sequence together, by level number', async () => {
        const error = await service
          .publishNewVersion(WorkflowType.TARIFF, { levels: [level(SUPER_ADMIN), level(FINANCE), level(OPERATIONS)] }, 9)
          .catch((e) => e);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toContain('Level 1: SUPER_ADMIN is a system-administration role');
        expect(error.message).toContain('Level 3: role "OPERATIONS" does not currently hold');
        expect(error.message).not.toContain('Level 2');
      });

      it('accepts exactly the roles the dropdown lists, and refuses the ones it does not', async () => {
        const listed = (await service.getEligibleApproverRoles(WorkflowType.TARIFF)).roles.map((r) => r.id);

        for (const role of ROLE_ROWS) {
          const save = service.publishNewVersion(WorkflowType.TARIFF, { levels: [level(role.id)] }, 9);
          if (listed.includes(role.id)) await expect(save).resolves.toBeDefined();
          else await expect(save).rejects.toThrow(BadRequestException);
        }
      });

      it('a role whose approve permission was revoked can no longer be saved as an approver', async () => {
        await expect(service.publishNewVersion(WorkflowType.TARIFF, { levels: [level(FINANCE)] }, 9)).resolves.toBeDefined();

        eligibleIds = [];

        await expect(service.publishNewVersion(WorkflowType.TARIFF, { levels: [level(FINANCE)] }, 9)).rejects.toThrow(/role "FINANCE" does not currently hold/);
      });

      it('keeps the configured sequence: levels saved in the submitted order as a NEW version, the previous ACTIVE one archived', async () => {
        eligibleIds = [FINANCE, OPERATIONS];

        await service.publishNewVersion(
          WorkflowType.TARIFF,
          { levels: [level(OPERATIONS, { slaValue: 1 }), level(FINANCE, { slaValue: 3 })] },
          9,
        );

        expect(txDefinitions.save).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 50, status: WorkflowDefinitionStatus.ARCHIVED }));
        expect(txDefinitions.create).toHaveBeenCalledWith(expect.objectContaining({ workflowType: 'TARIFF', version: 5, status: WorkflowDefinitionStatus.ACTIVE }));
        expect(txLevels.save).toHaveBeenCalledWith([
          expect.objectContaining({ levelOrder: 0, roleId: OPERATIONS, slaValue: 1, definitionId: 51 }),
          expect.objectContaining({ levelOrder: 1, roleId: FINANCE, slaValue: 3, definitionId: 51 }),
        ]);
      });

      it('still refuses the structural mistakes it always did (ESCALATE on the final level, an identical repeated level)', async () => {
        await expect(
          service.publishNewVersion(WorkflowType.TARIFF, { levels: [level(FINANCE, { onBreach: WorkflowOnBreach.ESCALATE })] }, 9),
        ).rejects.toThrow(/"Escalate to Next Level" is not allowed on the final level/);
        await expect(service.publishNewVersion(WorkflowType.TARIFF, { levels: [level(FINANCE), level(FINANCE)] }, 9)).rejects.toThrow(
          /Level 2 is identical to Level 1/,
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('WorkflowOrchestrationService.assertCanAct — who may act at the current level', () => {
    const STEP_ROLE = FINANCE;
    let instance: { id: number; status: WorkflowInstanceStatus; definitionId: number; currentLevelOrder: number };
    let instancesRepo: { findOne: jest.Mock };
    let stepsRepo: { findOne: jest.Mock };
    let levelsRepo: { count: jest.Mock };
    let userRoles: { getRoleIds: jest.Mock };
    let rolePermissions: { anyRoleIsAdministrator: jest.Mock };
    let actorRoleIds: number[];
    let service: WorkflowOrchestrationService;

    beforeEach(() => {
      instance = { id: 7, status: WorkflowInstanceStatus.WAITING_FOR_APPROVAL, definitionId: 50, currentLevelOrder: 0 };
      actorRoleIds = [STEP_ROLE];
      instancesRepo = { findOne: jest.fn().mockImplementation(() => Promise.resolve(instance)) };
      stepsRepo = { findOne: jest.fn().mockResolvedValue({ roleId: STEP_ROLE, action: null }) };
      levelsRepo = { count: jest.fn().mockResolvedValue(2) };
      userRoles = { getRoleIds: jest.fn().mockImplementation(() => Promise.resolve(actorRoleIds)) };
      rolePermissions = { anyRoleIsAdministrator: jest.fn().mockImplementation((ids: number[]) => Promise.resolve(ids.includes(SUPER_ADMIN))) };
      service = new WorkflowOrchestrationService(
        {} as never,
        {} as never,
        levelsRepo as never,
        instancesRepo as never,
        stepsRepo as never,
        userRoles as never,
        rolePermissions as never,
      );
    });

    it('lets the configured approver act, and says whether this is the final level', async () => {
      expect(await service.assertCanAct(WorkflowType.TARIFF, 1, 9)).toEqual({ instance, isFinalLevel: false });

      instance.currentLevelOrder = 1;
      expect(await service.assertCanAct(WorkflowType.TARIFF, 1, 9)).toEqual({ instance, isFinalLevel: true });
    });

    it('refuses a user who holds SUPER_ADMIN — whatever else they hold, even the very role the level is waiting on', async () => {
      actorRoleIds = [SUPER_ADMIN];
      await expect(service.assertCanAct(WorkflowType.TARIFF, 1, 9)).rejects.toThrow(
        new ForbiddenException('SUPER_ADMIN is a system-administration role and cannot approve or reject business transactions.'),
      );

      actorRoleIds = [SUPER_ADMIN, STEP_ROLE];
      await expect(service.assertCanAct(WorkflowType.TARIFF, 1, 9)).rejects.toThrow(/system-administration role/);
    });

    it('refuses a user whose roles do not include the level role', async () => {
      actorRoleIds = [OPERATIONS];

      await expect(service.assertCanAct(WorkflowType.TARIFF, 1, 9)).rejects.toThrow(/your role is not the configured approver for that level/);
    });

    it('the SLA scheduler\'s system actor needs no human role — and is never asked about SUPER_ADMIN', async () => {
      await expect(service.assertCanAct(WorkflowType.TARIFF, 1, undefined, undefined, true)).resolves.toEqual({ instance, isFinalLevel: false });

      expect(userRoles.getRoleIds).not.toHaveBeenCalled();
      expect(rolePermissions.anyRoleIsAdministrator).not.toHaveBeenCalled();
    });

    it('still refuses a missing actor, an already-processed item and an already-acted level', async () => {
      await expect(service.assertCanAct(WorkflowType.TARIFF, 1, undefined)).rejects.toThrow(/Could not determine the acting user/);

      instance.status = WorkflowInstanceStatus.COMPLETED;
      await expect(service.assertCanAct(WorkflowType.TARIFF, 1, 9)).rejects.toThrow(ConflictException);

      instance.status = WorkflowInstanceStatus.WAITING_FOR_APPROVAL;
      stepsRepo.findOne.mockResolvedValue({ roleId: STEP_ROLE, action: 'APPROVED' });
      await expect(service.assertCanAct(WorkflowType.TARIFF, 1, 9)).rejects.toThrow(/already been acted upon/);
    });

    it('proceeds exactly as before when no workflow was ever started for the object (backward compatible)', async () => {
      instancesRepo.findOne.mockResolvedValue(null);

      expect(await service.assertCanAct(WorkflowType.TARIFF, 1, 9)).toEqual({ instance: null, isFinalLevel: true });
      expect(userRoles.getRoleIds).not.toHaveBeenCalled();
    });
  });

  describe('no self-approval (unchanged)', () => {
    it('refuses the submitter acting on their own item, and lets another reviewer act', () => {
      expect(() => assertNotSelfReview(5, 5, 'approved')).toThrow(BadRequestException);
      expect(() => assertNotSelfReview(5, 6, 'approved')).not.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  describe('WorkflowService (the legacy approval-flow endpoints)', () => {
    let rolePermissions: { getRoleIdsHoldingAnyAction: jest.Mock };
    let rolesRepo: { find: jest.Mock };
    let dataSource: { query: jest.Mock; transaction: jest.Mock };
    let service: WorkflowService;

    beforeEach(() => {
      rolePermissions = { getRoleIdsHoldingAnyAction: jest.fn().mockResolvedValue([OPERATIONS, FINANCE]) };
      rolesRepo = {
        find: jest.fn().mockImplementation(({ where }: { where?: { id?: { value: number[] } } } = {}) =>
          Promise.resolve(ROLE_ROWS.filter((r) => (where?.id ? where.id.value.includes(r.id) : true))),
        ),
      };
      dataSource = { query: jest.fn(), transaction: jest.fn() };
      service = new WorkflowService(dataSource as never, rolesRepo as never, {} as never, rolePermissions as never);
    });

    it('getApprovalFlow names the roles whose POLICIES grant the approve code — and never reads role_permissions', async () => {
      const flow = await service.getApprovalFlow(WorkflowType.TARIFF);

      expect(rolePermissions.getRoleIdsHoldingAnyAction).toHaveBeenCalledWith(['TARIFF_APPROVE']);
      expect(rolesRepo.find).toHaveBeenCalledWith({ where: { id: In([OPERATIONS, FINANCE]) }, order: { roleName: 'ASC' } });
      expect(flow).toEqual({
        workflowType: 'TARIFF',
        levels: [{ level: 1, approverRoles: ['FINANCE', 'OPERATIONS'], approverRoleIds: [FINANCE, OPERATIONS] }],
      });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('setApprovers is retired: it answers 410 and writes nothing', async () => {
      await expect(service.setApprovers(WorkflowType.TARIFF, [SUPER_ADMIN, FINANCE])).rejects.toThrow(GoneException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(rolesRepo.find).not.toHaveBeenCalled();
    });

    it('the legacy advisory policy cannot record SUPER_ADMIN as an approver either', async () => {
      await expect(service.updateApprovalPolicy(WorkflowType.TARIFF, { levels: [level(SUPER_ADMIN)] })).rejects.toThrow(
        'Level 1: SUPER_ADMIN is a system-administration role and cannot be a workflow approver.',
      );

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
