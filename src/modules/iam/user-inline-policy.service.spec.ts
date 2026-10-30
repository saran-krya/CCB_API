import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserInlinePolicyService } from './user-inline-policy.service';
import { UserInlinePolicy } from './entities/user-inline-policy.entity';
import { UserInlinePolicyStatement } from './entities/user-inline-policy-statement.entity';
import { User } from '../user/entities/user.entity';
import { IamService } from './iam.service';
import { AuditService } from '../../audit/audit.service';

// Isolated tests for UserInlinePolicyService — the create/list/delete surface for policies attached
// directly to one user. Covers the server-side guardrails (nobody edits their OWN inline policies,
// statements validated by the same code shared Policies use, unique name per user), persistence
// (policy + statements saved atomically with their audit row, HARD delete so the unique key is never
// held by a soft-deleted row). Enforcement of what the saved grants allow is IamService's job and is
// covered in iam.service.spec.ts / live-role-authorization.spec.ts.
describe('UserInlinePolicyService', () => {
  const TARGET = 42;
  const ACTOR = 9;
  const DTO = { name: 'Temp tariff access', description: 'covering leave', statements: [{ resourceCode: 'TARIFF', actionCodes: ['TARIFF_VIEW'] }] };

  let service: UserInlinePolicyService;
  let policiesRepo: { find: jest.Mock; findOne: jest.Mock; findOneOrFail: jest.Mock; save: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  let statementsRepo: { save: jest.Mock; create: jest.Mock; delete: jest.Mock };
  let usersRepo: { findOne: jest.Mock };
  let iam: { validateStatements: jest.Mock };
  let audit: { record: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let manager: { getRepository: jest.Mock };

  beforeEach(async () => {
    policiesRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn().mockResolvedValue({ id: 100, userId: TARGET, name: DTO.name, statements: [] }),
      save: jest.fn().mockImplementation((p) => Promise.resolve({ id: 100, ...p })),
      create: jest.fn((data) => data),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    statementsRepo = {
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((data) => data),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    usersRepo = { findOne: jest.fn().mockResolvedValue({ id: TARGET }) };
    iam = { validateStatements: jest.fn().mockResolvedValue([{ resourceId: 10, actions: ['TARIFF_VIEW'] }]) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === UserInlinePolicy) return policiesRepo;
        if (entity === UserInlinePolicyStatement) return statementsRepo;
        return {};
      }),
    };
    dataSource = { transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserInlinePolicyService,
        { provide: getRepositoryToken(UserInlinePolicy), useValue: policiesRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: IamService, useValue: iam },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(UserInlinePolicyService);
  });

  describe('create', () => {
    it('refuses to change your OWN inline policies — checked before anything else is touched', async () => {
      await expect(service.create(ACTOR, DTO, ACTOR)).rejects.toThrow(new ForbiddenException('You cannot change your own permissions.'));

      expect(usersRepo.findOne).not.toHaveBeenCalled();
      expect(iam.validateStatements).not.toHaveBeenCalled();
      expect(policiesRepo.save).not.toHaveBeenCalled();
    });

    it('404s for a user that does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.create(TARGET, DTO, ACTOR)).rejects.toThrow(new NotFoundException('User not found'));
      expect(policiesRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a blank name (whitespace only)', async () => {
      await expect(service.create(TARGET, { ...DTO, name: '   ' }, ACTOR)).rejects.toThrow(BadRequestException);
      expect(policiesRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a name this user already has (409) before validating or saving anything', async () => {
      policiesRepo.findOne.mockResolvedValue({ id: 5, userId: TARGET, name: DTO.name });

      await expect(service.create(TARGET, DTO, ACTOR)).rejects.toThrow(ConflictException);
      expect(policiesRepo.findOne).toHaveBeenCalledWith({ where: { userId: TARGET, name: DTO.name } });
      expect(iam.validateStatements).not.toHaveBeenCalled();
      expect(policiesRepo.save).not.toHaveBeenCalled();
    });

    it('validates the statements with the SAME catalog rules shared Policies use, and saves nothing when they are invalid', async () => {
      iam.validateStatements.mockRejectedValue(new BadRequestException('Unknown action code "NOPE"'));

      await expect(service.create(TARGET, DTO, ACTOR)).rejects.toThrow(new BadRequestException('Unknown action code "NOPE"'));

      expect(iam.validateStatements).toHaveBeenCalledWith(DTO.statements);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(policiesRepo.save).not.toHaveBeenCalled();
    });

    it('saves the policy for the TARGET user and every statement as an Allow on the resolved resource, then returns it with its statements', async () => {
      const created = { id: 100, userId: TARGET, name: DTO.name, statements: [{ resource: { code: 'TARIFF' }, actions: ['TARIFF_VIEW'] }] };
      policiesRepo.findOneOrFail.mockResolvedValue(created);

      const result = await service.create(TARGET, DTO, ACTOR);

      expect(policiesRepo.create).toHaveBeenCalledWith({ userId: TARGET, name: DTO.name, description: DTO.description });
      expect(statementsRepo.save).toHaveBeenCalledWith([{ policyId: 100, resourceId: 10, effect: 'Allow', actions: ['TARIFF_VIEW'] }]);
      expect(policiesRepo.findOneOrFail).toHaveBeenCalledWith({ where: { id: 100 }, relations: { statements: { resource: true } } });
      expect(result).toBe(created);
    });

    it('trims the name before checking and saving it', async () => {
      await service.create(TARGET, { ...DTO, name: '  Temp tariff access  ' }, ACTOR);

      expect(policiesRepo.findOne).toHaveBeenCalledWith({ where: { userId: TARGET, name: 'Temp tariff access' } });
      expect(policiesRepo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Temp tariff access' }));
    });

    it('writes the audit row inside the SAME transaction (it can never record something that rolled back)', async () => {
      await service.create(TARGET, DTO, ACTOR);

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        {
          moduleName: 'user_inline_policies',
          entityId: TARGET,
          action: 'CREATE_INLINE_POLICY',
          newValue: { policyId: 100, name: DTO.name, statements: DTO.statements },
          performedBy: ACTOR,
        },
        manager,
      );
    });

    it('turns the unique-key violation of a concurrent duplicate create into a 409', async () => {
      dataSource.transaction.mockRejectedValue(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));

      await expect(service.create(TARGET, DTO, ACTOR)).rejects.toThrow(ConflictException);
    });

    it('lets any other persistence failure propagate untouched', async () => {
      dataSource.transaction.mockRejectedValue(new Error('connection lost'));

      await expect(service.create(TARGET, DTO, ACTOR)).rejects.toThrow('connection lost');
    });
  });

  describe('remove', () => {
    const existing = {
      id: 100,
      userId: TARGET,
      name: DTO.name,
      statements: [{ resource: { code: 'TARIFF' }, actions: ['TARIFF_VIEW'] }],
    };

    it('refuses to change your OWN inline policies', async () => {
      await expect(service.remove(ACTOR, 100, ACTOR)).rejects.toThrow(new ForbiddenException('You cannot change your own permissions.'));

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("404s for a policy that does not exist — and for one that belongs to a DIFFERENT user (lookup is scoped by userId)", async () => {
      policiesRepo.findOne.mockResolvedValue(null);

      await expect(service.remove(TARGET, 100, ACTOR)).rejects.toThrow(new NotFoundException('Inline policy not found'));

      expect(policiesRepo.findOne).toHaveBeenCalledWith({ where: { id: 100, userId: TARGET }, relations: { statements: { resource: true } } });
      expect(policiesRepo.delete).not.toHaveBeenCalled();
    });

    it('HARD-deletes: statements first, then the policy row (never a soft delete that would keep holding the unique name)', async () => {
      policiesRepo.findOne.mockResolvedValue(existing);

      const result = await service.remove(TARGET, 100, ACTOR);

      expect(statementsRepo.delete).toHaveBeenCalledWith({ policyId: 100 });
      expect(policiesRepo.delete).toHaveBeenCalledWith({ id: 100 });
      expect(statementsRepo.delete.mock.invocationCallOrder[0]).toBeLessThan(policiesRepo.delete.mock.invocationCallOrder[0]);
      expect(result).toEqual({ message: 'Inline policy deleted' });
    });

    it('audits what was removed, inside the same transaction', async () => {
      policiesRepo.findOne.mockResolvedValue(existing);

      await service.remove(TARGET, 100, ACTOR);

      expect(audit.record).toHaveBeenCalledWith(
        {
          moduleName: 'user_inline_policies',
          entityId: TARGET,
          action: 'DELETE_INLINE_POLICY',
          oldValue: { policyId: 100, name: DTO.name, statements: [{ resourceCode: 'TARIFF', actionCodes: ['TARIFF_VIEW'] }] },
          performedBy: ACTOR,
        },
        manager,
      );
    });
  });

  describe('findOne', () => {
    it('404s for an unknown user', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(TARGET, 100)).rejects.toThrow(new NotFoundException('User not found'));
      expect(policiesRepo.findOne).not.toHaveBeenCalled();
    });

    it("is scoped by userId: a missing policy — or one that belongs to a DIFFERENT user — is a 404, never a leak", async () => {
      policiesRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(TARGET, 100)).rejects.toThrow(new NotFoundException('Inline policy not found'));

      expect(policiesRepo.findOne).toHaveBeenCalledWith({
        where: { id: 100, userId: TARGET },
        relations: { statements: { resource: true } },
        order: { id: 'ASC', statements: { id: 'ASC' } },
      });
    });

    it('returns the policy with its statements and their resources', async () => {
      const policy = { id: 100, userId: TARGET, name: DTO.name, statements: [{ id: 1, resource: { code: 'TARIFF' }, actions: ['TARIFF_VIEW'] }] };
      policiesRepo.findOne.mockResolvedValue(policy);

      await expect(service.findOne(TARGET, 100)).resolves.toBe(policy);
    });
  });

  describe('update', () => {
    const EXISTING = {
      id: 100,
      userId: TARGET,
      name: 'Temp tariff access',
      description: 'old note',
      statements: [{ id: 1, resource: { code: 'TARIFF' }, actions: ['TARIFF_VIEW'] }],
    };
    const NEW_DTO = {
      name: 'Temp tariff access',
      description: 'new note',
      statements: [{ resourceCode: 'BILLING_CYCLE', actionCodes: ['VIEW_BILLING_CYCLE'] }],
    };

    beforeEach(() => {
      iam.validateStatements.mockResolvedValue([{ resourceId: 20, actions: ['VIEW_BILLING_CYCLE'] }]);
      // findOne serves three lookups: the scoped read, the duplicate-name probe, and the row lock.
      policiesRepo.findOne.mockImplementation((options: { where: { id?: number; name?: string } }) =>
        Promise.resolve(options.where.name !== undefined ? null : EXISTING),
      );
    });

    it('refuses to change your OWN inline policies — checked before anything else is touched', async () => {
      await expect(service.update(ACTOR, 100, NEW_DTO, ACTOR)).rejects.toThrow(new ForbiddenException('You cannot change your own permissions.'));

      expect(usersRepo.findOne).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('404s for a user that does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.update(TARGET, 100, NEW_DTO, ACTOR)).rejects.toThrow(new NotFoundException('User not found'));
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a blank name (whitespace only)', async () => {
      await expect(service.update(TARGET, 100, { ...NEW_DTO, name: '   ' }, ACTOR)).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("404s for a policy that does not exist — or belongs to a DIFFERENT user (the lookup is scoped by userId)", async () => {
      policiesRepo.findOne.mockResolvedValue(null);

      await expect(service.update(TARGET, 100, NEW_DTO, ACTOR)).rejects.toThrow(new NotFoundException('Inline policy not found'));

      expect(policiesRepo.findOne).toHaveBeenCalledWith({ where: { id: 100, userId: TARGET }, relations: { statements: { resource: true } } });
      expect(iam.validateStatements).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("rejects renaming to a name ANOTHER inline policy of this user already has (409) before saving anything", async () => {
      policiesRepo.findOne.mockImplementation((options: { where: { name?: string } }) =>
        Promise.resolve(options.where.name === 'Taken' ? { id: 7, userId: TARGET, name: 'Taken' } : EXISTING),
      );

      await expect(service.update(TARGET, 100, { ...NEW_DTO, name: 'Taken' }, ACTOR)).rejects.toThrow(ConflictException);

      expect(policiesRepo.findOne).toHaveBeenCalledWith({ where: { userId: TARGET, name: 'Taken' } });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('renaming to a different spelling of its OWN name (case-only) is NOT a conflict — the probe finds the policy itself', async () => {
      policiesRepo.findOne.mockImplementation((options: { where: { name?: string } }) =>
        Promise.resolve(options.where.name === 'temp TARIFF access' ? { id: 100, userId: TARGET, name: 'Temp tariff access' } : EXISTING),
      );

      await expect(service.update(TARGET, 100, { ...NEW_DTO, name: 'temp TARIFF access' }, ACTOR)).resolves.toBeDefined();

      expect(policiesRepo.update).toHaveBeenCalledWith({ id: 100 }, { name: 'temp TARIFF access', description: 'new note' });
    });

    it('keeping the SAME name never trips the duplicate check against itself', async () => {
      await service.update(TARGET, 100, NEW_DTO, ACTOR);

      expect(policiesRepo.findOne).not.toHaveBeenCalledWith({ where: { userId: TARGET, name: NEW_DTO.name } });
    });

    it('validates the statements with the SAME catalog rules as create, and saves nothing when they are invalid', async () => {
      iam.validateStatements.mockRejectedValue(new BadRequestException('Unknown action code "NOPE"'));

      await expect(service.update(TARGET, 100, NEW_DTO, ACTOR)).rejects.toThrow(new BadRequestException('Unknown action code "NOPE"'));

      expect(iam.validateStatements).toHaveBeenCalledWith(NEW_DTO.statements);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('locks the row, updates name + description, then REPLACES the statements (old ones deleted before the new are saved)', async () => {
      await service.update(TARGET, 100, { ...NEW_DTO, name: '  Renamed  ' }, ACTOR);

      expect(policiesRepo.findOne).toHaveBeenCalledWith({ where: { id: 100, userId: TARGET }, lock: { mode: 'pessimistic_write' } });
      expect(policiesRepo.update).toHaveBeenCalledWith({ id: 100 }, { name: 'Renamed', description: 'new note' });
      expect(statementsRepo.delete).toHaveBeenCalledWith({ policyId: 100 });
      expect(statementsRepo.save).toHaveBeenCalledWith([{ policyId: 100, resourceId: 20, effect: 'Allow', actions: ['VIEW_BILLING_CYCLE'] }]);
      expect(statementsRepo.delete.mock.invocationCallOrder[0]).toBeLessThan(statementsRepo.save.mock.invocationCallOrder[0]);
    });

    it('a blank description CLEARS it (stored as null — an omitted field would silently keep the old text)', async () => {
      await service.update(TARGET, 100, { ...NEW_DTO, description: '   ' }, ACTOR);
      expect(policiesRepo.update).toHaveBeenCalledWith({ id: 100 }, { name: 'Temp tariff access', description: null });

      policiesRepo.update.mockClear();
      await service.update(TARGET, 100, { name: NEW_DTO.name, statements: NEW_DTO.statements }, ACTOR);
      expect(policiesRepo.update).toHaveBeenCalledWith({ id: 100 }, { name: 'Temp tariff access', description: null });
    });

    it('returns the reloaded policy with its statements, in saved order', async () => {
      const reloaded = { ...EXISTING, description: 'new note', statements: [{ id: 2, resource: { code: 'BILLING_CYCLE' }, actions: ['VIEW_BILLING_CYCLE'] }] };
      policiesRepo.findOneOrFail.mockResolvedValue(reloaded);

      await expect(service.update(TARGET, 100, NEW_DTO, ACTOR)).resolves.toBe(reloaded);

      expect(policiesRepo.findOneOrFail).toHaveBeenCalledWith({
        where: { id: 100 },
        relations: { statements: { resource: true } },
        order: { id: 'ASC', statements: { id: 'ASC' } },
      });
    });

    it('audits BOTH the old and the new policy, inside the same transaction', async () => {
      await service.update(TARGET, 100, NEW_DTO, ACTOR);

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        {
          moduleName: 'user_inline_policies',
          entityId: TARGET,
          action: 'UPDATE_INLINE_POLICY',
          oldValue: { policyId: 100, name: 'Temp tariff access', description: 'old note', statements: [{ resourceCode: 'TARIFF', actionCodes: ['TARIFF_VIEW'] }] },
          newValue: { policyId: 100, name: 'Temp tariff access', description: 'new note', statements: NEW_DTO.statements },
          performedBy: ACTOR,
        },
        manager,
      );
    });

    it('404s — changing nothing — when the policy was deleted between the read and the lock', async () => {
      policiesRepo.findOne.mockImplementation((options: { lock?: unknown }) => Promise.resolve(options.lock ? null : EXISTING));

      await expect(service.update(TARGET, 100, NEW_DTO, ACTOR)).rejects.toThrow(new NotFoundException('Inline policy not found'));

      expect(policiesRepo.update).not.toHaveBeenCalled();
      expect(statementsRepo.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('turns the unique-key violation of a concurrent duplicate rename into a 409', async () => {
      dataSource.transaction.mockRejectedValue(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));

      await expect(service.update(TARGET, 100, NEW_DTO, ACTOR)).rejects.toThrow(ConflictException);
    });

    it('lets any other persistence failure propagate untouched', async () => {
      dataSource.transaction.mockRejectedValue(new Error('connection lost'));

      await expect(service.update(TARGET, 100, NEW_DTO, ACTOR)).rejects.toThrow('connection lost');
    });
  });

  describe('findAllForUser', () => {
    it('404s for an unknown user', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.findAllForUser(TARGET)).rejects.toThrow(NotFoundException);
      expect(policiesRepo.find).not.toHaveBeenCalled();
    });

    it("returns only that user's policies, oldest first, each with its statements and their resources", async () => {
      const rows = [{ id: 1, userId: TARGET, name: 'A', statements: [] }];
      policiesRepo.find.mockResolvedValue(rows);

      const result = await service.findAllForUser(TARGET);

      expect(policiesRepo.find).toHaveBeenCalledWith({
        where: { userId: TARGET },
        relations: { statements: { resource: true } },
        order: { id: 'ASC', statements: { id: 'ASC' } },
      });
      expect(result).toBe(rows);
    });

    it("lets a user READ their own inline policies — only changing them is blocked", async () => {
      await expect(service.findAllForUser(ACTOR)).resolves.toEqual([]);
    });
  });
});
