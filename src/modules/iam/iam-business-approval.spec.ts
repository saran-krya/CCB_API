import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ValidationPipe } from '@nestjs/common';
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
import { ACTIONS } from '../../bootstrap/seed-data';
import { BUSINESS_APPROVAL_ACTION_CODES } from './business-approval-actions';
import { CreatePolicyDto } from './dto/policy.dto';

// SUPER_ADMIN is a system-administration role: it never receives a business-approval code (tariff, billing cycle,
// bill run, registration, meter reading approve/reject), however a grant reaches it. Every dependency is mocked;
// the stores below are small in-memory fakes so the tests read like the scenario they describe.
describe('IamService — SUPER_ADMIN business-approval restriction', () => {
  type Statement = { id?: number; resourceId?: number; effect: string; actions: string[] };
  const allow = (...actions: string[]): Statement => ({ effect: 'Allow', actions });

  const SUPER_ADMIN = 1;
  const FINANCE = 2;
  const OPERATIONS = 3;
  const AUDITOR = 4;
  const LOOKALIKE = 5;

  let service: IamService;
  let resourcesRepo: { find: jest.Mock; findOne: jest.Mock };
  let policiesRepo: { findOne: jest.Mock; save: jest.Mock; update: jest.Mock; create: jest.Mock };
  let statementsRepo: { find: jest.Mock; delete: jest.Mock; save: jest.Mock; create: jest.Mock };
  let rolePoliciesRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock; remove: jest.Mock; find: jest.Mock };
  let userInlineRepo: { find: jest.Mock };
  let roleInlineRepo: { find: jest.Mock };
  let rolesRepo: { findOne: jest.Mock; find: jest.Mock };
  let actionsRepo: { find: jest.Mock };
  let auditService: { record: jest.Mock };
  let manager: { getRepository: jest.Mock; createQueryBuilder: jest.Mock; connection: { getMetadata: jest.Mock }; query: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: unknown; query: jest.Mock };

  // The fake database the repositories read from.
  let roleRows: { id: number; roleName: string }[];
  let attached: { roleId: number; policyId?: number; policy?: { id: number; statements: Statement[] } }[];
  let roleInline: { roleId: number; statements: Statement[] }[];
  let userInline: { userId: number; statements: Statement[] }[];

  // TypeORM hands the repositories `In(...)` operators or plain values; read either.
  const idsOf = (where: unknown): number[] | undefined => {
    if (where === undefined || where === null) return undefined;
    if (typeof where === 'number') return [where];
    return (where as { value?: number[] }).value;
  };

  beforeEach(async () => {
    roleRows = [
      { id: SUPER_ADMIN, roleName: 'SUPER_ADMIN' },
      { id: FINANCE, roleName: 'FINANCE' },
      { id: OPERATIONS, roleName: 'OPERATIONS' },
      { id: AUDITOR, roleName: 'AUDITOR' },
      // The database matches role names case-insensitively; only the EXACT reserved name is SUPER_ADMIN.
      { id: LOOKALIKE, roleName: 'Super_Admin' },
    ];
    attached = [];
    roleInline = [];
    userInline = [];

    resourcesRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    policiesRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((p) => Promise.resolve({ id: 100, ...p })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((data) => data),
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
      find: jest.fn().mockImplementation(({ where }: { where?: { roleId?: unknown; policyId?: number } } = {}) => {
        const roleIds = idsOf(where?.roleId);
        return Promise.resolve(
          attached.filter((row) => (roleIds ? roleIds.includes(row.roleId) : true) && (where?.policyId === undefined || row.policyId === where.policyId)),
        );
      }),
    };
    userInlineRepo = {
      find: jest.fn().mockImplementation(({ where }: { where: { userId: number } }) =>
        Promise.resolve(userInline.filter((row) => row.userId === where.userId)),
      ),
    };
    roleInlineRepo = {
      find: jest.fn().mockImplementation(({ where }: { where?: { roleId?: unknown } } = {}) => {
        const roleIds = idsOf(where?.roleId);
        return Promise.resolve(roleInline.filter((row) => (roleIds ? roleIds.includes(row.roleId) : true)));
      }),
    };
    rolesRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockImplementation(({ where }: { where?: { id?: unknown } } = {}) => {
        const ids = idsOf(where?.id);
        return Promise.resolve(roleRows.filter((role) => (ids ? ids.includes(role.id) : true)));
      }),
    };
    actionsRepo = { find: jest.fn().mockResolvedValue([]) };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    const releaseQuery = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Policy) return policiesRepo;
        if (entity === PolicyStatement) return statementsRepo;
        if (entity === RolePolicy) return rolePoliciesRepo;
        if (entity === RoleInlinePolicy) return roleInlineRepo;
        return {};
      }),
      createQueryBuilder: jest.fn(() => releaseQuery),
      connection: {
        getMetadata: jest.fn().mockReturnValue({
          name: 'Policy',
          findColumnWithPropertyName: (property: string) => ({ databaseName: property }),
          deleteDateColumn: { databaseName: 'deleted_at' },
        }),
      },
      query: jest.fn().mockResolvedValue([]),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
      manager,
      query: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        IamService,
        { provide: getRepositoryToken(Resource), useValue: resourcesRepo },
        { provide: getRepositoryToken(Policy), useValue: policiesRepo },
        { provide: getRepositoryToken(PolicyStatement), useValue: statementsRepo },
        { provide: getRepositoryToken(RolePolicy), useValue: rolePoliciesRepo },
        { provide: getRepositoryToken(UserInlinePolicy), useValue: userInlineRepo },
        { provide: getRepositoryToken(RoleInlinePolicy), useValue: roleInlineRepo },
        { provide: getRepositoryToken(Role), useValue: rolesRepo },
        { provide: getRepositoryToken(Action), useValue: actionsRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(IamService);
  });

  afterEach(() => jest.restoreAllMocks());

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('the permission resolver (behind PermissionGuard, GET /auth/me/actions and every service check)', () => {
    const ADMIN_CODES = ['VIEW_USER', 'CREATE_USER', 'TARIFF_VIEW', 'TARIFF_SUBMIT', 'WORKFLOW_VIEW', 'WORKFLOW_MANAGE_APPROVERS'];

    it('drops every business-approval code from a SUPER_ADMIN principal and keeps its administrative, view and maker codes', async () => {
      attached = [{ roleId: SUPER_ADMIN, policy: { id: 1, statements: [allow(...ADMIN_CODES, ...BUSINESS_APPROVAL_ACTION_CODES)] } }];

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([SUPER_ADMIN]);

      for (const code of BUSINESS_APPROVAL_ACTION_CODES) expect(codes.has(code)).toBe(false);
      expect([...codes].sort()).toEqual([...ADMIN_CODES].sort());
    });

    it.each([...BUSINESS_APPROVAL_ACTION_CODES])('SUPER_ADMIN is refused %s even though a policy lists it', async (code) => {
      attached = [{ roleId: SUPER_ADMIN, policy: { id: 1, statements: [allow(code)] } }];

      expect(await service.rolesHaveActionViaPolicy([SUPER_ADMIN], code)).toBe(false);
    });

    it("a role's inline policy cannot hand SUPER_ADMIN an approval either", async () => {
      roleInline = [{ roleId: SUPER_ADMIN, statements: [allow('BILL_RUN_APPROVE', 'BILL_RUN_VIEW')] }];

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([SUPER_ADMIN]);

      expect([...codes]).toEqual(['BILL_RUN_VIEW']);
    });

    it("a user's OWN inline policy cannot hand a SUPER_ADMIN holder an approval, but still grants its other codes", async () => {
      userInline = [{ userId: 42, statements: [allow('TARIFF_APPROVE', 'EDIT_USER')] }];

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([SUPER_ADMIN], 42);

      expect([...codes]).toEqual(['EDIT_USER']);
    });

    it('a user who holds SUPER_ADMIN AND another role gets no approval code from either, and still gets the other role\'s remaining codes', async () => {
      attached = [
        { roleId: SUPER_ADMIN, policy: { id: 1, statements: [allow('VIEW_USER')] } },
        { roleId: FINANCE, policy: { id: 2, statements: [allow('BILL_RUN_VIEW', 'BILL_RUN_APPROVE', 'TARIFF_APPROVE')] } },
      ];

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([FINANCE, SUPER_ADMIN]);

      expect([...codes].sort()).toEqual(['BILL_RUN_VIEW', 'VIEW_USER']);
    });

    it('does not touch anyone WITHOUT the SUPER_ADMIN role — a multi-role union keeps every approval code', async () => {
      attached = [
        { roleId: FINANCE, policy: { id: 2, statements: [allow('BILL_RUN_APPROVE', 'TARIFF_APPROVE')] } },
        { roleId: OPERATIONS, policy: { id: 3, statements: [allow('METER_READING_APPROVE', 'TARIFF_VIEW')] } },
      ];
      userInline = [{ userId: 7, statements: [allow('BILLING_CYCLE_APPROVE')] }];

      const codes = await service.getActionCodesGrantedByPoliciesForRoles([FINANCE, OPERATIONS], 7);

      expect([...codes].sort()).toEqual(['BILLING_CYCLE_APPROVE', 'BILL_RUN_APPROVE', 'METER_READING_APPROVE', 'TARIFF_APPROVE', 'TARIFF_VIEW']);
    });

    it('matches the EXACT reserved role name — a look-alike such as "Super_Admin" keeps its codes', async () => {
      attached = [{ roleId: LOOKALIKE, policy: { id: 9, statements: [allow('TARIFF_APPROVE')] } }];

      expect(await service.rolesHaveActionViaPolicy([LOOKALIKE], 'TARIFF_APPROVE')).toBe(true);
    });

    it('is decided on every call, never cached — the same policy resolves differently for different principals', async () => {
      attached = [
        { roleId: SUPER_ADMIN, policy: { id: 1, statements: [allow('TARIFF_APPROVE')] } },
        { roleId: FINANCE, policy: { id: 2, statements: [allow('TARIFF_APPROVE')] } },
      ];

      expect(await service.rolesHaveActionViaPolicy([SUPER_ADMIN], 'TARIFF_APPROVE')).toBe(false);
      expect(await service.rolesHaveActionViaPolicy([FINANCE], 'TARIFF_APPROVE')).toBe(true);
      expect(await service.rolesHaveActionViaPolicy([SUPER_ADMIN], 'TARIFF_APPROVE')).toBe(false);
    });

    it('asks the roles table about the SUPER_ADMIN role by id only, one small query, and not at all for an empty principal', async () => {
      await service.getActionCodesGrantedByPoliciesForRoles([]);
      expect(rolesRepo.find).not.toHaveBeenCalled();

      await service.getActionCodesGrantedByPoliciesForRoles([FINANCE]);
      expect(rolesRepo.find).toHaveBeenCalledTimes(1);
      const options = rolesRepo.find.mock.calls[0][0];
      expect(options.where.id).toEqual(In([FINANCE]));
      expect(options.select).toEqual({ id: true, roleName: true });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('ensureAdminPolicyGrants — startup, reseed and migrations never restore the approvals', () => {
    const realActions = ACTIONS.map((action, index) => ({ id: index + 1, code: action.code, isActive: true }));
    const realResources = RESOURCES.map((resource, index) => ({ id: index + 1, code: resource.code }));
    const resourceIdOf = (actionCode: string) =>
      realResources.find((resource) => RESOURCES.find((r) => r.code === resource.code)!.actionCodes.includes(actionCode))!.id;

    // A SUPER_ADMIN system policy the way an OLDER version of the sync left it: approvals included.
    const olderSystemPolicy = () => ({
      id: 100,
      name: 'SUPER_ADMIN Policy',
      isSystem: true,
      description: 'System policy granting "SUPER_ADMIN" every active, supported resource and action. Missing permissions are added automatically, never removed.',
      statements: [
        { id: 1, resourceId: resourceIdOf('TARIFF_VIEW'), effect: 'Allow', actions: ['TARIFF_VIEW', 'TARIFF_APPROVE', 'TARIFF_REJECT'] },
        { id: 2, resourceId: resourceIdOf('METER_READING_APPROVE'), effect: 'Allow', actions: ['METER_READING_APPROVE'] },
        { id: 3, resourceId: resourceIdOf('BILL_RUN_VIEW'), effect: 'Allow', actions: ['BILL_RUN_VIEW', 'BILL_RUN_APPROVE', 'BILL_RUN_HISTORICAL_APPROVE'] },
        { id: 4, resourceId: resourceIdOf('WORKFLOW_MANAGE_APPROVERS'), effect: 'Allow', actions: ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE_APPROVERS'] },
      ] as Statement[],
    });

    // Wires the repositories to ONE in-memory policy, so a second boot sees exactly what the first boot wrote.
    function wireSystemPolicy(policy: ReturnType<typeof olderSystemPolicy>, extraAttached: unknown[] = []) {
      let nextId = 1000;
      rolesRepo.find.mockImplementation(() => Promise.resolve([{ id: SUPER_ADMIN, roleName: 'SUPER_ADMIN' }]));
      resourcesRepo.find.mockResolvedValue(realResources);
      actionsRepo.find.mockResolvedValue(realActions);
      statementsRepo.create.mockImplementation((data: object) => ({ ...data }));
      statementsRepo.save.mockImplementation(async (statement: Statement) => {
        if (statement.id === undefined) {
          statement.id = nextId++;
          policy.statements.push(statement);
        }
        return statement;
      });
      statementsRepo.delete.mockImplementation(async (id: number) => {
        policy.statements = policy.statements.filter((s) => s.id !== id);
      });
      statementsRepo.find.mockImplementation(async () => policy.statements);
      rolePoliciesRepo.find.mockImplementation(async () => [{ roleId: SUPER_ADMIN, policy }, ...extraAttached]);
    }

    const heldBy = (policy: { statements: Statement[] }) => policy.statements.flatMap((s) => s.actions);

    it('strips every business-approval code an older sync left in the system policy, deletes a statement left empty, and keeps everything else', async () => {
      const policy = olderSystemPolicy();
      wireSystemPolicy(policy);

      await service.ensureAdminPolicyGrants();

      for (const code of BUSINESS_APPROVAL_ACTION_CODES) expect(heldBy(policy)).not.toContain(code);
      // administrative and view permissions — including WORKFLOW_MANAGE_APPROVERS — are intact
      expect(heldBy(policy)).toEqual(expect.arrayContaining(['TARIFF_VIEW', 'BILL_RUN_VIEW', 'WORKFLOW_VIEW', 'WORKFLOW_MANAGE_APPROVERS']));
      // the METER_READING statement held nothing but an approval, so it went with it
      expect(statementsRepo.delete).toHaveBeenCalledWith(2);
      expect(policy.statements.find((s) => s.id === 2)).toBeUndefined();
      // and every other active, non-approval code of the catalogue is granted
      const expected = RESOURCES.flatMap((r) => r.actionCodes).filter(
        (code) => ACTIONS.some((a) => a.code === code) && !BUSINESS_APPROVAL_ACTION_CODES.has(code),
      );
      for (const code of expected) expect(heldBy(policy)).toContain(code);
    });

    it('rewrites the stored description of the system policy so it no longer claims every action', async () => {
      const policy = olderSystemPolicy();
      wireSystemPolicy(policy);

      await service.ensureAdminPolicyGrants();

      expect(policiesRepo.update).toHaveBeenCalledWith(
        { id: 100 },
        { description: expect.stringContaining('except business-transaction approvals') },
      );
      expect(policiesRepo.update.mock.calls[0][1].description.length).toBeLessThanOrEqual(500); // policies.description is varchar(500)
    });

    it('restart after restart changes nothing more — and a reseed or migration that puts the approvals back is undone by the next boot', async () => {
      const policy = olderSystemPolicy();
      wireSystemPolicy(policy);

      await service.ensureAdminPolicyGrants(); // first boot after the upgrade

      statementsRepo.save.mockClear();
      statementsRepo.delete.mockClear();
      policiesRepo.update.mockClear();
      await service.ensureAdminPolicyGrants(); // an ordinary restart
      expect(statementsRepo.save).not.toHaveBeenCalled();
      expect(statementsRepo.delete).not.toHaveBeenCalled();
      expect(policiesRepo.update).not.toHaveBeenCalled();
      for (const code of BUSINESS_APPROVAL_ACTION_CODES) expect(heldBy(policy)).not.toContain(code);

      // a later migration / hand edit puts two approvals back…
      policy.statements.find((s) => s.resourceId === resourceIdOf('TARIFF_VIEW'))!.actions.push('TARIFF_APPROVE');
      policy.statements.find((s) => s.resourceId === resourceIdOf('BILL_RUN_VIEW'))!.actions.push('BILL_RUN_APPROVE');
      await service.ensureAdminPolicyGrants(); // …and the next boot removes them again
      for (const code of BUSINESS_APPROVAL_ACTION_CODES) expect(heldBy(policy)).not.toContain(code);
    });

    it('throws instead of reporting success when an approval code is STILL in the system policy after the sync', async () => {
      const policy = olderSystemPolicy();
      wireSystemPolicy(policy);
      // the strip "succeeds" but a fresh read of the rows still finds one — a write that did not persist
      statementsRepo.find.mockResolvedValue([{ id: 1, effect: 'Allow', actions: ['TARIFF_APPROVE'] }]);

      await expect(service.ensureAdminPolicyGrants()).rejects.toThrow(
        /business-approval code\(s\) still in its system policy: TARIFF_APPROVE/,
      );
    });

    it('edits ONLY the system-managed policy: another policy attached to SUPER_ADMIN is left alone, and the boot says so', async () => {
      const policy = olderSystemPolicy();
      const other = { id: 55, name: 'Old finance policy', isSystem: false, statements: [{ id: 90, effect: 'Allow', actions: ['TARIFF_APPROVE', 'TARIFF_VIEW'] }] };
      wireSystemPolicy(policy, [{ roleId: SUPER_ADMIN, policy: other }]);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await service.ensureAdminPolicyGrants();

      expect(other.statements[0].actions).toEqual(['TARIFF_APPROVE', 'TARIFF_VIEW']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('another policy attached to SUPER_ADMIN lists business-approval code(s) TARIFF_APPROVE'));
    });

    it('a role merely called ADMIN is just another role: the boot sync creates no Policy for it and grants it nothing', async () => {
      // SUPER_ADMIN is the ONLY predefined role; nothing here may look any other role up, whatever it is called.
      rolesRepo.find.mockImplementation(() => Promise.resolve([{ id: 9, roleName: 'ADMIN' }]));
      resourcesRepo.find.mockResolvedValue(realResources);
      actionsRepo.find.mockResolvedValue(realActions);
      rolePoliciesRepo.find.mockReset();

      await service.ensureAdminPolicyGrants();

      expect(rolePoliciesRepo.find).not.toHaveBeenCalled();
      expect(policiesRepo.save).not.toHaveBeenCalled();
      expect(rolePoliciesRepo.save).not.toHaveBeenCalled();
      expect(statementsRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('writes: SUPER_ADMIN cannot be handed an approval through a policy', () => {
    describe('attachPolicyToRole', () => {
      const approvalPolicy = { id: 7, name: 'Billing approvers' };

      beforeEach(() => {
        policiesRepo.findOne.mockResolvedValue(approvalPolicy);
        rolePoliciesRepo.findOne.mockResolvedValue(null);
      });

      it('refuses to attach a policy that lists a business-approval code to SUPER_ADMIN, and attaches nothing', async () => {
        rolesRepo.findOne.mockResolvedValue({ id: SUPER_ADMIN, roleName: 'SUPER_ADMIN' });
        statementsRepo.find.mockResolvedValue([{ effect: 'Allow', actions: ['BILL_RUN_VIEW', 'BILL_RUN_APPROVE'] }]);

        await expect(service.attachPolicyToRole(SUPER_ADMIN, 7, 99)).rejects.toThrow(
          /SUPER_ADMIN is a system-administration role and cannot be granted business approval permissions \(BILL_RUN_APPROVE\)/,
        );

        expect(rolePoliciesRepo.save).not.toHaveBeenCalled();
        expect(auditService.record).not.toHaveBeenCalled();
      });

      it('still attaches a policy with only administrative or view codes to SUPER_ADMIN', async () => {
        rolesRepo.findOne.mockResolvedValue({ id: SUPER_ADMIN, roleName: 'SUPER_ADMIN' });
        statementsRepo.find.mockResolvedValue([{ effect: 'Allow', actions: ['VIEW_USER', 'WORKFLOW_MANAGE_APPROVERS'] }]);

        await service.attachPolicyToRole(SUPER_ADMIN, 7, 99);

        expect(rolePoliciesRepo.save).toHaveBeenCalledWith({ roleId: SUPER_ADMIN, policyId: 7 });
      });

      it('attaches the same approval policy to a business role without any restriction', async () => {
        rolesRepo.findOne.mockResolvedValue({ id: FINANCE, roleName: 'FINANCE' });
        statementsRepo.find.mockResolvedValue([{ effect: 'Allow', actions: ['BILL_RUN_APPROVE'] }]);

        await service.attachPolicyToRole(FINANCE, 7, 99);

        expect(rolePoliciesRepo.save).toHaveBeenCalledWith({ roleId: FINANCE, policyId: 7 });
      });
    });

    describe('updatePolicy', () => {
      const RESOURCE_TARIFF = { id: 10, code: 'TARIFF' };
      const policy = { id: 7, name: 'Tariff team', description: 'd', isSystem: false };
      const dto = (...actionCodes: string[]) => ({ name: 'Tariff team', description: 'd', statements: [{ resourceCode: 'TARIFF', actionCodes }] });

      beforeEach(() => {
        policiesRepo.findOne.mockImplementation(({ where }: { where: { id?: number; name?: string } }) =>
          Promise.resolve(where.name !== undefined ? null : { ...policy }),
        );
        resourcesRepo.find.mockResolvedValue([RESOURCE_TARIFF]);
        actionsRepo.find.mockResolvedValue(
          ['TARIFF_VIEW', 'TARIFF_APPROVE'].map((code, i) => ({ id: i + 1, code, isActive: true })),
        );
        jest.spyOn(service, 'findOnePolicy').mockResolvedValue({ id: 7 } as never);
      });

      it('refuses an edit that adds a business-approval code to a policy attached to SUPER_ADMIN — before opening a transaction', async () => {
        attached = [{ roleId: SUPER_ADMIN, policyId: 7 }, { roleId: FINANCE, policyId: 7 }];

        await expect(service.updatePolicy(7, dto('TARIFF_VIEW', 'TARIFF_APPROVE'), 99)).rejects.toThrow(BadRequestException);

        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('allows the same edit when the policy is attached only to business roles', async () => {
        attached = [{ roleId: FINANCE, policyId: 7 }];

        await service.updatePolicy(7, dto('TARIFF_VIEW', 'TARIFF_APPROVE'), 99);

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      });
    });

    describe('assertNoBusinessApprovalForSuperAdmin', () => {
      it('refuses an inline grant for a USER who holds SUPER_ADMIN', async () => {
        dataSource.query.mockResolvedValue([{ role_name: 'AUDITOR' }, { role_name: 'SUPER_ADMIN' }]);

        await expect(service.assertNoBusinessApprovalForSuperAdmin(['TARIFF_APPROVE'], { userId: 42 })).rejects.toThrow(BadRequestException);
        expect(dataSource.query.mock.calls[0][1]).toEqual([42]);
      });

      it('allows it for a user without SUPER_ADMIN, and a look-alike role name is not SUPER_ADMIN', async () => {
        dataSource.query.mockResolvedValue([{ role_name: 'Super_Admin' }, { role_name: 'FINANCE' }]);

        await expect(service.assertNoBusinessApprovalForSuperAdmin(['TARIFF_APPROVE'], { userId: 42 })).resolves.toBeUndefined();
      });

      it('refuses a role inline grant for the SUPER_ADMIN role', async () => {
        await expect(service.assertNoBusinessApprovalForSuperAdmin(['METER_READING_APPROVE'], { roleIds: [SUPER_ADMIN] })).rejects.toThrow(
          /METER_READING_APPROVE/,
        );
      });

      it('asks the database nothing when no restricted code is involved', async () => {
        await service.assertNoBusinessApprovalForSuperAdmin(['VIEW_USER', 'TARIFF_VIEW'], { roleIds: [SUPER_ADMIN], userId: 42 });

        expect(rolesRepo.find).not.toHaveBeenCalled();
        expect(dataSource.query).not.toHaveBeenCalled();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('getRoleIdsHoldingAnyAction — who may be configured as an approver (the one eligibility predicate)', () => {
    it('is every live, non-SUPER_ADMIN role whose attached policies OR own inline policies grant the code', async () => {
      attached = [
        { roleId: FINANCE, policy: { id: 1, statements: [allow('TARIFF_VIEW', 'TARIFF_APPROVE')] } },
        { roleId: SUPER_ADMIN, policy: { id: 2, statements: [allow('TARIFF_APPROVE')] } }, // legacy data: still never eligible
        { roleId: 99, policy: { id: 3, statements: [allow('TARIFF_APPROVE')] } }, // a deleted role's leftover row
        { roleId: AUDITOR, policy: { id: 4, statements: [{ effect: 'Deny', actions: ['TARIFF_APPROVE'] }] } }, // not a grant
      ];
      roleInline = [{ roleId: OPERATIONS, statements: [allow('TARIFF_APPROVE')] }];

      expect((await service.getRoleIdsHoldingAnyAction(['TARIFF_APPROVE'])).sort()).toEqual([FINANCE, OPERATIONS]);
    });

    it('matches ANY of several codes, and a role holding none of them is not eligible', async () => {
      attached = [
        { roleId: FINANCE, policy: { id: 1, statements: [allow('BILL_RUN_APPROVE')] } },
        { roleId: OPERATIONS, policy: { id: 2, statements: [allow('BILL_RUN_VIEW')] } },
      ];

      expect(await service.getRoleIdsHoldingAnyAction(['BILL_RUN_APPROVE', 'TARIFF_APPROVE'])).toEqual([FINANCE]);
    });

    it('reflects a revocation on the very next call — nothing is cached', async () => {
      attached = [{ roleId: FINANCE, policy: { id: 1, statements: [allow('TARIFF_APPROVE')] } }];
      expect(await service.getRoleIdsHoldingAnyAction(['TARIFF_APPROVE'])).toEqual([FINANCE]);

      attached = []; // the policy was detached from the role
      expect(await service.getRoleIdsHoldingAnyAction(['TARIFF_APPROVE'])).toEqual([]);
    });

    it('answers an empty code list without touching the database', async () => {
      expect(await service.getRoleIdsHoldingAnyAction([])).toEqual([]);
      expect(rolePoliciesRepo.find).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('assertApproverEligibilityKept — a policy change may not strand a configured approver', () => {
    // Active workflow levels as the SQL would return them for the roles and workflow types asked about.
    let levels: { role_id: number; role_name: string; workflow_type: string; level_order: number }[];

    beforeEach(() => {
      levels = [
        { role_id: FINANCE, role_name: 'FINANCE', workflow_type: 'TARIFF', level_order: 1 },
        { role_id: FINANCE, role_name: 'FINANCE', workflow_type: 'BILL_RUN', level_order: 0 },
      ];
      // Like the real query: only the roles and workflow types asked about, ordered by workflow type then level.
      manager.query.mockImplementation((_sql: string, params: unknown[]) =>
        Promise.resolve(
          levels
            .filter((l) => params.includes(l.role_id) && params.includes(l.workflow_type))
            .sort((a, b) => a.workflow_type.localeCompare(b.workflow_type) || a.level_order - b.level_order),
        ),
      );
    });

    it('does nothing — and runs no query — when the removed codes are not workflow approve codes', async () => {
      await service.assertApproverEligibilityKept(manager as never, [FINANCE], ['TARIFF_VIEW', 'VIEW_USER'], 'This edit');

      expect(manager.query).not.toHaveBeenCalled();
    });

    it('throws 409 naming the role, the level and the workflow when the approver no longer holds the approve code', async () => {
      attached = [{ roleId: FINANCE, policy: { id: 1, statements: [allow('TARIFF_VIEW')] } }]; // TARIFF_APPROVE already removed

      const error = await service
        .assertApproverEligibilityKept(manager as never, [FINANCE], ['TARIFF_APPROVE'], 'Detaching this policy')
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        'Detaching this policy would remove the approve permission from role "FINANCE" at Level 2 of the TARIFF workflow. ' +
          "Change that workflow's approver first, or keep the permission.",
      );
    });

    it('reads the role through the TRANSACTION manager, so it judges its own uncommitted change', async () => {
      attached = [];

      await service.assertApproverEligibilityKept(manager as never, [FINANCE], ['TARIFF_APPROVE'], 'x').catch(() => undefined);

      expect(manager.getRepository).toHaveBeenCalledWith(RolePolicy);
      expect(manager.getRepository).toHaveBeenCalledWith(RoleInlinePolicy);
    });

    it('passes when another attached policy or an inline policy still grants the code', async () => {
      attached = [{ roleId: FINANCE, policy: { id: 2, statements: [allow('TARIFF_APPROVE')] } }];
      await expect(service.assertApproverEligibilityKept(manager as never, [FINANCE], ['TARIFF_APPROVE'], 'x')).resolves.toBeUndefined();

      attached = [];
      roleInline = [{ roleId: FINANCE, statements: [allow('TARIFF_APPROVE')] }];
      await expect(service.assertApproverEligibilityKept(manager as never, [FINANCE], ['TARIFF_APPROVE'], 'x')).resolves.toBeUndefined();
    });

    it('only examines workflows whose approve code was removed — losing BILL_RUN_APPROVE never blocks over the TARIFF level', async () => {
      attached = [{ roleId: FINANCE, policy: { id: 1, statements: [allow('BILL_RUN_APPROVE')] } }]; // TARIFF_APPROVE long gone

      await expect(service.assertApproverEligibilityKept(manager as never, [FINANCE], ['TARIFF_VIEW', 'BILL_RUN_APPROVE'], 'x')).resolves.toBeUndefined();

      expect(manager.query.mock.calls[0][1]).toEqual([FINANCE, 'BILL_RUN']);
    });

    it('lists every stranded level when several are affected', async () => {
      attached = [];

      await expect(service.assertApproverEligibilityKept(manager as never, [FINANCE], ['TARIFF_APPROVE', 'BILL_RUN_APPROVE'], 'This edit')).rejects.toThrow(
        /role "FINANCE" at Level 1 of the BILL_RUN workflow; role "FINANCE" at Level 2 of the TARIFF workflow/,
      );
    });

    it('ignores a SUPER_ADMIN level — it is never eligible, which is reported where the workflow is published', async () => {
      levels = [{ role_id: SUPER_ADMIN, role_name: 'SUPER_ADMIN', workflow_type: 'TARIFF', level_order: 0 }];
      attached = [];

      await expect(service.assertApproverEligibilityKept(manager as never, [SUPER_ADMIN], ['TARIFF_APPROVE'], 'x')).resolves.toBeUndefined();
    });

    it('queries only ACTIVE definitions and live levels', async () => {
      attached = [{ roleId: FINANCE, policy: { id: 1, statements: [allow('TARIFF_APPROVE')] } }];

      await service.assertApproverEligibilityKept(manager as never, [FINANCE], ['TARIFF_APPROVE'], 'x');

      const sql = manager.query.mock.calls[0][0] as string;
      expect(sql).toMatch(/d\.status = 'ACTIVE'/);
      expect(sql).toMatch(/d\.deleted_at IS NULL/);
      expect(sql).toMatch(/l\.deleted_at IS NULL/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('the revoking paths run that check', () => {
    it('detaching a policy with an approve code runs the removal in a transaction and lets the 409 roll it back', async () => {
      rolePoliciesRepo.findOne.mockResolvedValue({ id: 1, roleId: FINANCE, policyId: 7 });
      rolesRepo.findOne.mockResolvedValue({ id: FINANCE, roleName: 'FINANCE' });
      statementsRepo.find.mockResolvedValue([{ effect: 'Allow', actions: ['TARIFF_VIEW', 'TARIFF_APPROVE'] }]);
      const guard = jest.spyOn(service, 'assertApproverEligibilityKept').mockRejectedValue(new ConflictException('would strand an approver'));

      await expect(service.detachPolicyFromRole(FINANCE, 7, 99)).rejects.toThrow(ConflictException);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(guard).toHaveBeenCalledWith(manager, [FINANCE], ['TARIFF_APPROVE'], 'Detaching this policy');
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('detaching a policy without any approve code is the plain removal it always was — no transaction, no check', async () => {
      const attachment = { id: 1, roleId: FINANCE, policyId: 7 };
      rolePoliciesRepo.findOne.mockResolvedValue(attachment);
      rolesRepo.findOne.mockResolvedValue({ id: FINANCE, roleName: 'FINANCE' });
      statementsRepo.find.mockResolvedValue([{ effect: 'Allow', actions: ['TARIFF_VIEW', 'BILL_RUN_VIEW'] }]);
      const guard = jest.spyOn(service, 'assertApproverEligibilityKept');

      await service.detachPolicyFromRole(FINANCE, 7, 99);

      expect(rolePoliciesRepo.remove).toHaveBeenCalledWith(attachment);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(guard).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });

    describe('editing a managed policy', () => {
      beforeEach(() => {
        policiesRepo.findOne.mockImplementation(({ where }: { where: { name?: string } }) =>
          Promise.resolve(where.name !== undefined ? null : { id: 7, name: 'Tariff team', description: 'd', isSystem: false }),
        );
        resourcesRepo.find.mockResolvedValue([{ id: 10, code: 'TARIFF' }]);
        actionsRepo.find.mockResolvedValue(['TARIFF_VIEW', 'TARIFF_APPROVE'].map((code, i) => ({ id: i + 1, code, isActive: true })));
        statementsRepo.find.mockResolvedValue([{ resourceId: 10, effect: 'Allow', actions: ['TARIFF_VIEW', 'TARIFF_APPROVE'] }]);
        attached = [{ roleId: FINANCE, policyId: 7 }, { roleId: OPERATIONS, policyId: 7 }];
        jest.spyOn(service, 'findOnePolicy').mockResolvedValue({ id: 7 } as never);
      });

      const edit = (...actionCodes: string[]) => ({ name: 'Tariff team', description: 'd', statements: [{ resourceCode: 'TARIFF', actionCodes }] });

      it('dropping an approve code checks every role the policy is attached to, inside the editing transaction', async () => {
        const guard = jest.spyOn(service, 'assertApproverEligibilityKept').mockResolvedValue(undefined);

        await service.updatePolicy(7, edit('TARIFF_VIEW'), 99);

        expect(guard).toHaveBeenCalledWith(manager, [FINANCE, OPERATIONS], ['TARIFF_APPROVE'], 'This policy edit');
      });

      it('a 409 from that check aborts the edit before it is audited', async () => {
        jest.spyOn(service, 'assertApproverEligibilityKept').mockRejectedValue(new ConflictException('would strand an approver'));

        await expect(service.updatePolicy(7, edit('TARIFF_VIEW'), 99)).rejects.toThrow(ConflictException);

        expect(auditService.record).not.toHaveBeenCalled();
      });

      it('an edit that keeps the approve code never runs the check', async () => {
        const guard = jest.spyOn(service, 'assertApproverEligibilityKept');

        await service.updatePolicy(7, edit('TARIFF_VIEW', 'TARIFF_APPROVE'), 99);

        expect(guard).not.toHaveBeenCalled();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('policy statement validation — managed, role-inline and user-inline policies share one rule set', () => {
    // All three accept the same CreatePolicyDto/UpdatePolicyDto, so one pipe check covers all three routes.
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    // The pipe reports each violated rule in the 400 body's `message` list.
    const violations = async (body: unknown): Promise<string[]> => {
      try {
        await pipe.transform(body, { type: 'body', metatype: CreatePolicyDto });
        return [];
      } catch (error) {
        return ((error as BadRequestException).getResponse() as { message: string[] }).message;
      }
    };

    it('rejects a statement that carries an effect — Allow is the only effect and it is never client-chosen', async () => {
      const body = { name: 'P', statements: [{ resourceCode: 'TARIFF', actionCodes: ['TARIFF_VIEW'], effect: 'Deny' }] };

      expect(await violations(body)).toContain('statements.0.property effect should not exist');
    });

    it('rejects a payload that tries to smuggle in system-only fields', async () => {
      const body = { name: 'P', isSystem: true, statements: [{ resourceCode: 'TARIFF', actionCodes: ['TARIFF_VIEW'] }] };

      expect(await violations(body)).toContain('property isSystem should not exist');
    });

    it('rejects a statement with no action codes, and non-string action codes', async () => {
      expect(await violations({ name: 'P', statements: [{ resourceCode: 'TARIFF', actionCodes: [] }] })).not.toEqual([]);
      expect(await violations({ name: 'P', statements: [{ resourceCode: 'TARIFF', actionCodes: [42] }] })).not.toEqual([]);
    });

    it('accepts the well-formed payload', async () => {
      expect(await violations({ name: 'P', statements: [{ resourceCode: 'TARIFF', actionCodes: ['TARIFF_VIEW'] }] })).toEqual([]);
    });

    describe('validateStatements (what all three write paths call)', () => {
      beforeEach(() => {
        resourcesRepo.find.mockResolvedValue([{ id: 10, code: 'TARIFF' }, { id: 11, code: 'BILL_RUN' }]);
        actionsRepo.find.mockResolvedValue(['TARIFF_VIEW', 'TARIFF_APPROVE', 'BILL_RUN_VIEW'].map((code, i) => ({ id: i + 1, code, isActive: true })));
      });

      it('rejects an unknown action code, an inactive one (only active codes are loaded) and a code of another resource', async () => {
        await expect(service.validateStatements([{ resourceCode: 'TARIFF', actionCodes: ['NOPE'] }])).rejects.toThrow('Unknown action code "NOPE"');
        await expect(service.validateStatements([{ resourceCode: 'TARIFF', actionCodes: ['TARIFF_DEPRECATE'] }])).rejects.toThrow(
          'Unknown action code "TARIFF_DEPRECATE"',
        );
        await expect(service.validateStatements([{ resourceCode: 'TARIFF', actionCodes: ['BILL_RUN_VIEW'] }])).rejects.toThrow(
          'Action "BILL_RUN_VIEW" does not belong to resource "TARIFF"',
        );
      });

      it('rejects the same resource in two statements, and an unknown resource', async () => {
        await expect(
          service.validateStatements([
            { resourceCode: 'TARIFF', actionCodes: ['TARIFF_VIEW'] },
            { resourceCode: 'TARIFF', actionCodes: ['TARIFF_APPROVE'] },
          ]),
        ).rejects.toThrow(/appears in more than one statement/);
        await expect(service.validateStatements([{ resourceCode: 'NOPE', actionCodes: ['TARIFF_VIEW'] }])).rejects.toThrow('Unknown resource code "NOPE"');
      });

      it('de-duplicates repeated codes inside one statement and returns resolved resource ids', async () => {
        const resolved = await service.validateStatements([{ resourceCode: 'TARIFF', actionCodes: ['TARIFF_VIEW', 'TARIFF_VIEW', 'TARIFF_APPROVE'] }]);

        expect(resolved).toEqual([{ resourceId: 10, actions: ['TARIFF_VIEW', 'TARIFF_APPROVE'] }]);
      });
    });
  });
});
