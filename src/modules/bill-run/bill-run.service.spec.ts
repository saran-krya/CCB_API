import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BillRunService } from './bill-run.service';
import { BillRun, BillRunStatus } from './entities/bill-run.entity';
import { BillRunBatch } from './entities/bill-run-batch.entity';
import { Property } from '../property/entities/property.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { BillingReadinessService, BillingReadinessStatus } from '../billing-readiness/billing-readiness.service';
import { BillingCycleService } from '../billing-cycle/billing-cycle.service';
import { BillingManagementService } from '../billing-management/billing-management.service';
import { BillingCycleMaster } from '../billing-cycle/entities/billing-cycle-master.entity';
import { AuditService } from '../../audit/audit.service';
import { WorkflowOrchestrationService } from '../workflow/workflow-orchestration.service';
import { User } from '../user/entities/user.entity';

// Isolated unit tests for BillRunService.submit's two paths (routine current-cycle, and Missed
// Reading Recovery via an explicit readingDate) — every dependency mocked, no real database
// connection. Grand Tower A's real, confirmed shape is mirrored as fixture data: property 41,
// version 22 (ACTIVE, not DEPRECATED — current AND the version 2026-09-28 resolves to), real
// period 2026-09-27..2026-09-30, 24 units, SMT-AZG-003 (unit 2050) the only one with a reading.

function qbStub(getOneResult: BillRun | null) {
  return {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(getOneResult),
  };
}

describe('BillRunService.submit', () => {
  let service: BillRunService;
  let billRunsRepo: { findOne: jest.Mock; createQueryBuilder?: jest.Mock };
  let billingReadiness: {
    getReadiness: jest.Mock;
    checkRecoveredReadingEligibility: jest.Mock;
  };
  let billingCycleService: {
    getReadingPeriodForProperty: jest.Mock;
    getHistoricalVersionsForProperty: jest.Mock;
    getVersionDayConfig: jest.Mock;
  };
  let workflowOrchestration: { registerAutoApproveHandler: jest.Mock; startInstance: jest.Mock };
  let auditService: { record: jest.Mock; findByModuleAndEntity: jest.Mock };
  let usersRepo: { find: jest.Mock };
  let manager: { createQueryBuilder: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const ROUTINE_READY = {
    propertyId: 41,
    propertyName: 'Grand Tower A',
    propertyCode: 'PRP-000041',
    communityId: 14,
    communityName: 'Azizi Grand',
    cyclePeriodStart: '2026-10-27',
    cyclePeriodEnd: '2026-10-30',
    cycleVersionId: 22,
    status: BillingReadinessStatus.READY,
    reasons: [],
    billableUnits: 24,
    occupiedUnits: 24,
    unitsMissingTariff: 0,
    unitsMissingMeterMapping: 0,
    unitsMissingReading: 0,
    criticalAnomalies: 0,
    highAnomalies: 0,
    mediumAnomalies: 0,
    lowAnomalies: 0,
  };

  const ROUTINE_CYCLE_INFO = {
    closed: true,
    periodStart: '2026-10-27',
    periodEnd: '2026-10-30',
    masterId: 9,
    versionId: 22,
    billGenerationDays: 1,
    billIssueDays: 2,
    billDueDays: 21,
  };

  function makeUnit(id: number, meterCode: string, hasReading: boolean) {
    return {
      unitId: id,
      unitNumber: `AZG-T01-${String(id - 2047).padStart(2, '0')}`,
      hasQualifyingReading: hasReading,
      meterBusinessCode: meterCode,
      tariffStatus: 'resolved' as const,
      tariffVersionId: 26,
      resolvedCustomer: { id: 68, businessCode: 'CUS-000068', fullName: 'Test Tenant' },
      occupantVerificationRequired: true,
    };
  }

  const ALL_24_UNITS_ONLY_SMT003_QUALIFIES = Array.from({ length: 24 }, (_, i) =>
    makeUnit(2048 + i, `SMT-AZG-${String(i + 1).padStart(3, '0')}`, i === 2),
  );

  const ELIGIBLE_SEPTEMBER = {
    propertyId: 41,
    propertyName: 'Grand Tower A',
    propertyCode: 'PRP-000041',
    readingDate: '2026-09-28',
    resolution: 'resolved' as const,
    cycleVersionId: 22,
    periodStart: '2026-09-27',
    periodEnd: '2026-09-30',
    ageDays: 16,
    eligibleForBilling: true,
    blockingReasons: [] as string[],
    missingReadingMeterIds: [] as string[],
    existingBillRun: null,
    units: ALL_24_UNITS_ONLY_SMT003_QUALIFIES.map((u) => ({ ...u, hasQualifyingReading: true })),
  };

  const NOT_ELIGIBLE_23_MISSING = {
    ...ELIGIBLE_SEPTEMBER,
    eligibleForBilling: false,
    blockingReasons: ['23 of 24 required meter(s) are missing a qualifying reading for this cycle — never assumed to be zero consumption'],
    missingReadingMeterIds: ALL_24_UNITS_ONLY_SMT003_QUALIFIES.filter((u) => !u.hasQualifyingReading).map((u) => u.meterBusinessCode),
    units: ALL_24_UNITS_ONLY_SMT003_QUALIFIES,
  };

  beforeEach(async () => {
    billRunsRepo = { findOne: jest.fn() };
    billingReadiness = {
      getReadiness: jest.fn().mockResolvedValue([ROUTINE_READY]),
      checkRecoveredReadingEligibility: jest.fn().mockResolvedValue(ELIGIBLE_SEPTEMBER),
    };
    billingCycleService = {
      getReadingPeriodForProperty: jest.fn().mockResolvedValue(ROUTINE_CYCLE_INFO),
      // Version 22 is ACTIVE (current), not DEPRECATED — getHistoricalVersionsForProperty correctly
      // returns [] for it; submitWithinTransaction's recovery path must fall back to
      // getReadingPeriodForProperty for the masterId only (never its period).
      getHistoricalVersionsForProperty: jest.fn().mockResolvedValue([]),
      getVersionDayConfig: jest.fn().mockResolvedValue({ billGenerationDays: 1, billIssueDays: 2, billDueDays: 21 }),
    };
    workflowOrchestration = {
      registerAutoApproveHandler: jest.fn(),
      startInstance: jest.fn().mockResolvedValue(undefined),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined), findByModuleAndEntity: jest.fn().mockResolvedValue([]) };
    usersRepo = { find: jest.fn().mockResolvedValue([]) };

    manager = {
      createQueryBuilder: jest.fn().mockReturnValue(qbStub(null)),
      create: jest.fn().mockImplementation((_entity, data) => ({ ...data })),
      save: jest.fn().mockImplementation((_entity, data) => Promise.resolve({ id: 501, ...data })),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillRunService,
        { provide: getRepositoryToken(BillRun), useValue: billRunsRepo },
        { provide: getRepositoryToken(BillRunBatch), useValue: { findOne: jest.fn(), find: jest.fn() } },
        { provide: getRepositoryToken(Property), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(MeterReading), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(BillingCycleMaster), useValue: { createQueryBuilder: jest.fn() } },
        { provide: BillingReadinessService, useValue: billingReadiness },
        { provide: BillingCycleService, useValue: billingCycleService },
        { provide: BillingManagementService, useValue: { generateBillsForBillRun: jest.fn(), getSummary: jest.fn() } },
        { provide: AuditService, useValue: auditService },
        { provide: DataSource, useValue: dataSource },
        { provide: WorkflowOrchestrationService, useValue: workflowOrchestration },
      ],
    }).compile();

    service = moduleRef.get(BillRunService);
    // findOne() is called at the end of submit() to re-fetch with relations — stub it to return
    // whatever was just "saved" by manager.save, keyed loosely since these tests assert on the
    // save() call args directly, not on findOne's own relation-loading behavior (untested here,
    // unrelated to this feature).
    jest.spyOn(service, 'findOne').mockImplementation((id: number) =>
      Promise.resolve({ id } as unknown as BillRun),
    );
  });

  describe('routine (no readingDate) — unchanged behavior', () => {
    it('submits using getReadingPeriodForProperty\'s current period, never calls checkRecoveredReadingEligibility', async () => {
      await service.submit({ propertyId: 41, notes: 'routine' }, 7);

      expect(billingReadiness.checkRecoveredReadingEligibility).not.toHaveBeenCalled();
      expect(billingCycleService.getReadingPeriodForProperty).toHaveBeenCalledWith(41);
      expect(manager.create).toHaveBeenCalledWith(BillRun, expect.objectContaining({
        cycleVersionId: 22,
        cyclePeriodStart: '2026-10-27',
        cyclePeriodEnd: '2026-10-30',
        tariffResolutionDate: null,
      }));
    });

    it('still blocks when the property is not Ready (existing behavior untouched)', async () => {
      billingReadiness.getReadiness.mockResolvedValue([{ ...ROUTINE_READY, status: BillingReadinessStatus.NOT_READY }]);
      await expect(service.submit({ propertyId: 41 }, 7)).rejects.toThrow(BadRequestException);
    });

    it('still blocks when the cycle has not closed (existing behavior untouched)', async () => {
      billingCycleService.getReadingPeriodForProperty.mockResolvedValue({ ...ROUTINE_CYCLE_INFO, closed: false });
      await expect(service.submit({ propertyId: 41 }, 7)).rejects.toThrow(BadRequestException);
    });
  });

  describe('recovery (readingDate supplied) — the September scenario', () => {
    it('the exact Grand Tower A case: resolves version 22, period 2026-09-27..2026-09-30, and submits with tariffResolutionDate set', async () => {
      await service.submit(
        { propertyId: 41, readingDate: '2026-09-28', occupantVerificationConfirmed: true, notes: 'recovered reading' },
        7,
      );

      expect(billingReadiness.checkRecoveredReadingEligibility).toHaveBeenCalledWith(41, '2026-09-28');
      expect(manager.create).toHaveBeenCalledWith(BillRun, expect.objectContaining({
        cycleMasterId: 9,
        cycleVersionId: 22,
        cyclePeriodStart: '2026-09-27',
        cyclePeriodEnd: '2026-09-30',
        tariffResolutionDate: '2026-09-27',
        billableUnits: 24,
      }));
    });

    it('blocks submission when occupantVerificationConfirmed is not explicitly true, even though eligibleForBilling is true', async () => {
      await expect(
        service.submit({ propertyId: 41, readingDate: '2026-09-28', occupantVerificationConfirmed: false }, 7),
      ).rejects.toThrow(/occupant verification is required/i);
      // Never even reaches the point of creating a row — occupancy is checked before any insert.
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('blocks submission when occupantVerificationConfirmed is omitted entirely', async () => {
      await expect(
        service.submit({ propertyId: 41, readingDate: '2026-09-28' }, 7),
      ).rejects.toThrow(/occupant verification is required/i);
    });

    it('missing readings: blocks with the exact "23 of 24" reason and never creates a row', async () => {
      billingReadiness.checkRecoveredReadingEligibility.mockResolvedValue(NOT_ELIGIBLE_23_MISSING);

      await expect(
        service.submit({ propertyId: 41, readingDate: '2026-09-28', occupantVerificationConfirmed: true }, 7),
      ).rejects.toThrow(/23 of 24 required meter/i);
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('resolution "none": blocks with the unresolved-date reason, never creates a row', async () => {
      billingReadiness.checkRecoveredReadingEligibility.mockResolvedValue({
        ...ELIGIBLE_SEPTEMBER,
        resolution: 'none' as const,
        cycleVersionId: null,
        eligibleForBilling: false,
        blockingReasons: ['No billing-cycle version covers 2026-09-01 for this property — the reading cannot be resolved to a billing period'],
      });

      await expect(
        service.submit({ propertyId: 41, readingDate: '2026-09-01', occupantVerificationConfirmed: true }, 7),
      ).rejects.toThrow(/cannot be resolved to a billing period/i);
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('resolution "ambiguous": blocks explicitly, never guesses a version', async () => {
      billingReadiness.checkRecoveredReadingEligibility.mockResolvedValue({
        ...ELIGIBLE_SEPTEMBER,
        resolution: 'ambiguous' as const,
        cycleVersionId: null,
        eligibleForBilling: false,
        blockingReasons: ['More than one billing-cycle version\'s computed reading period covers 2026-09-28 — this cannot be resolved automatically'],
      });

      await expect(
        service.submit({ propertyId: 41, readingDate: '2026-09-28', occupantVerificationConfirmed: true }, 7),
      ).rejects.toThrow(/cannot be resolved automatically/i);
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('duplicate submission: blocks via the SAME pessimistic_write lock the routine path uses, scoped to this cycleVersionId', async () => {
      const existingRecoveryRun = { id: 99, businessCode: 'BR-000099', status: BillRunStatus.PENDING_APPROVAL } as BillRun;
      manager.createQueryBuilder.mockReturnValue(qbStub(existingRecoveryRun));

      await expect(
        service.submit({ propertyId: 41, readingDate: '2026-09-28', occupantVerificationConfirmed: true }, 7),
      ).rejects.toThrow(ConflictException);
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('a DIFFERENT historical period for the SAME property is never blocked by another period\'s existing bill run — the lock is scoped by cycleVersionId, not just propertyId', async () => {
      // A query builder stub that actually filters by the cycle_version_id param, the same way the
      // real `.andWhere('br.cycle_version_id = :versionId', ...)` SQL does — a stub that ignores the
      // param (like the plain qbStub above, used only when the test wants "any lookup returns X")
      // would let a scoping bug in the real query pass silently.
      const EXISTING_RUNS_BY_VERSION: Record<number, BillRun> = {
        16: { id: 99, businessCode: 'BR-000099', status: BillRunStatus.PENDING_APPROVAL } as BillRun,
      };
      manager.createQueryBuilder.mockImplementation(() => {
        let versionId: number | undefined;
        const stub: Record<string, jest.Mock> = {};
        stub.setLock = jest.fn(() => stub);
        stub.where = jest.fn(() => stub);
        stub.andWhere = jest.fn((_sql: string, params: Record<string, unknown>) => {
          if (params && 'versionId' in params) versionId = params.versionId as number;
          return stub;
        });
        stub.getOne = jest.fn(() => Promise.resolve(versionId !== undefined ? (EXISTING_RUNS_BY_VERSION[versionId] ?? null) : null));
        return stub;
      });
      // Resolves to version 22 (current cycle, per ROUTINE_CYCLE_INFO/ELIGIBLE_SEPTEMBER fixtures)
      // — a DIFFERENT version than the one with an existing run (16) above.
      billingReadiness.checkRecoveredReadingEligibility.mockResolvedValue(ELIGIBLE_SEPTEMBER);

      await expect(
        service.submit({ propertyId: 41, readingDate: '2026-09-28', occupantVerificationConfirmed: true }, 7),
      ).resolves.toBeDefined();
      expect(manager.create).toHaveBeenCalledWith(BillRun, expect.objectContaining({ cycleVersionId: 22 }));
    });

    it('a REJECTED prior recovery run for the same version does NOT block a fresh submission (same statuses excluded as the routine path)', async () => {
      // qbStub(null) default — the lock query itself filters IN (PENDING_APPROVAL, APPROVED), so a
      // real rejected row would never be returned by it; this asserts the call succeeds through.
      await service.submit({ propertyId: 41, readingDate: '2026-09-28', occupantVerificationConfirmed: true }, 7);
      expect(manager.create).toHaveBeenCalled();
    });
  });

  describe('findAll — period-wise Billing History filters (periodFrom/periodTo)', () => {
    function findAllQbStub(allRows: BillRun[]) {
      const predicates: { sql: string; params: Record<string, any> }[] = [];
      let working = [...allRows];

      function apply(sql: string, params: Record<string, any>) {
        predicates.push({ sql, params });
        if (sql.includes('br.cycle_period_start >= :periodFrom')) {
          working = working.filter((r) => r.cyclePeriodStart >= params.periodFrom);
        } else if (sql.includes('br.cycle_period_start <= :periodTo')) {
          working = working.filter((r) => r.cyclePeriodStart <= params.periodTo);
        }
      }

      const qb: any = {
        leftJoinAndSelect: () => qb,
        orderBy: () => qb,
        andWhere: (sql: string, params: Record<string, any>) => {
          apply(sql, params);
          return qb;
        },
        skip: () => qb,
        take: () => qb,
        getManyAndCount: async () => [working, working.length],
      };
      return qb;
    }

    const SEPT_RUN = { id: 1, cyclePeriodStart: '2026-09-27' } as BillRun;
    const OCT_RUN = { id: 2, cyclePeriodStart: '2026-10-27' } as BillRun;

    it('periodFrom/periodTo filter on cyclePeriodStart (the run\'s OWN billing period), not submittedOn', async () => {
      billRunsRepo.createQueryBuilder = jest.fn().mockReturnValue(findAllQbStub([SEPT_RUN, OCT_RUN]));

      const result = await service.findAll({ periodFrom: '2026-09-01', periodTo: '2026-09-30', page: 1, limit: 20 } as any);

      expect(result.items.map((i) => i.id)).toEqual([1]);
    });

    it('omitting periodFrom/periodTo applies no date predicate at all (existing behavior unchanged)', async () => {
      const qb = findAllQbStub([SEPT_RUN, OCT_RUN]);
      billRunsRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.findAll({ page: 1, limit: 20 } as any);

      expect(result.items.map((i) => i.id).sort()).toEqual([1, 2]);
    });
  });

  describe('getApprovalHistory', () => {
    it('throws NotFoundException for an unknown bill run id, before querying any audit rows', async () => {
      billRunsRepo.findOne.mockResolvedValue(null);
      await expect(service.getApprovalHistory(999)).rejects.toThrow(NotFoundException);
      expect(auditService.findByModuleAndEntity).not.toHaveBeenCalled();
    });

    it('returns real audit events in order, with oldValue/newValue JSON-parsed and performedBy resolved to a real user', async () => {
      billRunsRepo.findOne.mockResolvedValue({ id: 42 } as BillRun);
      auditService.findByModuleAndEntity.mockResolvedValue([
        {
          id: 901,
          action: 'APPROVE',
          createdAt: new Date('2026-10-06T10:55:38Z'),
          performedBy: 7,
          oldValue: JSON.stringify({ status: 'pending_approval' }),
          newValue: JSON.stringify({ status: 'approved', reviewedById: 7 }),
        },
        {
          id: 900,
          action: 'SUBMIT',
          createdAt: new Date('2026-10-01T09:00:00Z'),
          performedBy: 3,
          oldValue: null,
          newValue: JSON.stringify({ propertyId: 41, status: 'pending_approval', readingDate: null }),
        },
      ]);
      usersRepo.find.mockResolvedValue([
        { id: 7, firstName: 'Jane', lastName: 'Doe' },
        { id: 3, firstName: 'John', lastName: 'Smith' },
      ]);

      const history = await service.getApprovalHistory(42);

      expect(auditService.findByModuleAndEntity).toHaveBeenCalledWith('BillRun', 42);
      expect(usersRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: expect.anything() } }));
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        id: 901,
        action: 'APPROVE',
        createdAt: new Date('2026-10-06T10:55:38Z'),
        performedBy: { id: 7, firstName: 'Jane', lastName: 'Doe' },
        oldValue: { status: 'pending_approval' },
        newValue: { status: 'approved', reviewedById: 7 },
      });
      expect(history[1].performedBy).toEqual({ id: 3, firstName: 'John', lastName: 'Smith' });
      expect(history[1].oldValue).toBeNull();
    });

    it('a performedBy id with no matching user still returns the id, never silently dropped', async () => {
      billRunsRepo.findOne.mockResolvedValue({ id: 42 } as BillRun);
      auditService.findByModuleAndEntity.mockResolvedValue([
        { id: 902, action: 'SUBMIT', createdAt: new Date(), performedBy: 999, oldValue: null, newValue: '{}' },
      ]);
      usersRepo.find.mockResolvedValue([]); // user 999 no longer exists / was deleted

      const history = await service.getApprovalHistory(42);

      expect(history[0].performedBy).toEqual({ id: 999 });
    });

    it('a null performedBy (e.g. a system auto-approval) is reported as null, never a fabricated user', async () => {
      billRunsRepo.findOne.mockResolvedValue({ id: 42 } as BillRun);
      auditService.findByModuleAndEntity.mockResolvedValue([
        { id: 903, action: 'APPROVE', createdAt: new Date(), performedBy: null, oldValue: null, newValue: '{}' },
      ]);

      const history = await service.getApprovalHistory(42);

      expect(history[0].performedBy).toBeNull();
    });
  });
});

// Global Past Billing Overview — separate describe block: a genuinely different method (estate-wide
// orchestration across getHistoricalVersionsForProperty + evaluateHistoricalCycle), with its own
// dependency shapes (billingCycleMasters.createQueryBuilder, billingReadiness.evaluateHistoricalCycle)
// that BillRunService.submit's own tests above never exercise.
describe('BillRunService.getPastBillingOverview', () => {
  let service: BillRunService;
  let billingCycleMastersRepo: { createQueryBuilder: jest.Mock };
  let billingCycleService: { getHistoricalVersionsForProperty: jest.Mock };
  let billingReadiness: { evaluateHistoricalCycle: jest.Mock };
  let billingManagement: { getSummary: jest.Mock };

  // Mirrors the real Grand Tower A (missing) / Crest Tower A (blocked) shape confirmed live against
  // the dev database earlier — property 41/version 16 genuinely has no BillRun and is eligible;
  // property 65/version 19 genuinely has insufficient readings. A third, synthetic property (99) is
  // added for the pending/approved/duplicate-prevention/permission-adjacent scenarios this suite
  // needs that don't exist in the live dev data today.
  const MASTER_ROWS = [
    { propertyId: 41, propertyName: 'Grand Tower A', propertyCode: 'AZG-T01', communityId: 14, communityName: 'Azizi Grand' },
    { propertyId: 65, propertyName: 'Crest Tower A', propertyCode: 'AZC-T01', communityId: 17, communityName: 'Azizi Crest' },
    { propertyId: 99, propertyName: 'Test Court B', propertyCode: 'TCB-T01', communityId: 17, communityName: 'Azizi Crest' },
  ];

  const HISTORICAL_VERSIONS: Record<number, Array<{ versionId: number; masterId: number; periodStart: string; periodEnd: string; effectiveFrom: string; deprecatedOn: string | null; ageDays: number }>> = {
    41: [{ versionId: 16, masterId: 9, periodStart: '2026-09-25', periodEnd: '2026-09-30', effectiveFrom: '2026-09-25', deprecatedOn: '2026-09-28', ageDays: 17 }],
    65: [{ versionId: 19, masterId: 11, periodStart: '2026-09-03', periodEnd: '2026-09-27', effectiveFrom: '2026-09-03', deprecatedOn: '2026-09-27', ageDays: 20 }],
    99: [
      { versionId: 30, masterId: 22, periodStart: '2026-08-01', periodEnd: '2026-08-28', effectiveFrom: '2026-08-01', deprecatedOn: '2026-08-28', ageDays: 50 },
      { versionId: 31, masterId: 22, periodStart: '2026-09-01', periodEnd: '2026-09-28', effectiveFrom: '2026-09-01', deprecatedOn: '2026-09-28', ageDays: 20 },
    ],
  };

  function evaluatedResult(overrides: Partial<{
    propertyId: number; propertyName: string; cycleVersionId: number; periodStart: string; periodEnd: string;
    eligibleForBilling: boolean; blockingReasons: string[]; existingBillRun: { id: number; businessCode: string | null; status: string } | null; units: unknown[];
  }>) {
    return {
      propertyId: overrides.propertyId,
      propertyName: overrides.propertyName,
      propertyCode: null,
      cycleVersionId: overrides.cycleVersionId,
      periodStart: overrides.periodStart,
      periodEnd: overrides.periodEnd,
      ageDays: 20,
      eligibleForBilling: overrides.eligibleForBilling ?? true,
      blockingReasons: overrides.blockingReasons ?? [],
      missingReadingMeterIds: [] as string[],
      existingBillRun: overrides.existingBillRun ?? null,
      units: overrides.units ?? Array.from({ length: 24 }, (_, i) => ({ unitId: i })),
    };
  }

  // A real query builder applies .andWhere(...) filters before .getRawMany() ever resolves — a stub
  // that ignores the filter args and always returns every row would let a broken WHERE clause pass
  // silently. This mirrors the real propertyId/communityId filtering getPastBillingOverview's own
  // masterQb construction performs, so these tests actually exercise that filtering, not just the
  // in-memory candidate logic downstream of it. Each createQueryBuilder() call gets its own
  // `filters` closure — a fresh stub per call, matching how a real repository's createQueryBuilder
  // never shares state across separate calls either.
  function billingCycleMastersQbStub(): Record<string, jest.Mock> {
    const filters: { propertyId?: number; communityId?: number } = {};
    const stub: Record<string, jest.Mock> = {};
    stub.innerJoin = jest.fn(() => stub);
    stub.where = jest.fn(() => stub);
    stub.andWhere = jest.fn((_sql: string, params: Record<string, unknown>) => {
      if (params && 'propertyId' in params) filters.propertyId = params.propertyId as number;
      if (params && 'communityId' in params) filters.communityId = params.communityId as number;
      return stub;
    });
    stub.select = jest.fn(() => stub);
    stub.addSelect = jest.fn(() => stub);
    stub.getRawMany = jest.fn(() => Promise.resolve(
      MASTER_ROWS.filter((m) =>
        (filters.propertyId === undefined || m.propertyId === filters.propertyId) &&
        (filters.communityId === undefined || m.communityId === filters.communityId),
      ),
    ));
    return stub;
  }

  beforeEach(async () => {
    billingCycleMastersRepo = {
      createQueryBuilder: jest.fn().mockImplementation(() => billingCycleMastersQbStub()),
    };
    billingCycleService = {
      getHistoricalVersionsForProperty: jest.fn().mockImplementation((propertyId: number) =>
        Promise.resolve(HISTORICAL_VERSIONS[propertyId] ?? []),
      ),
    };
    billingReadiness = {
      // Default: every (property, version) is a clean "missing, eligible" result — individual tests
      // override specific (propertyId, cycleVersionId) pairs below via mockImplementation.
      evaluateHistoricalCycle: jest.fn().mockImplementation((propertyId: number, cycleVersionId: number) =>
        Promise.resolve(evaluatedResult({ propertyId, propertyName: 'Unknown', cycleVersionId, periodStart: '2026-09-01', periodEnd: '2026-09-28' })),
      ),
    };
    billingManagement = { getSummary: jest.fn().mockResolvedValue({ totalBills: 0 }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillRunService,
        { provide: getRepositoryToken(BillRun), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(BillRunBatch), useValue: { findOne: jest.fn(), find: jest.fn() } },
        { provide: getRepositoryToken(Property), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(MeterReading), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(BillingCycleMaster), useValue: billingCycleMastersRepo },
        { provide: BillingReadinessService, useValue: billingReadiness },
        { provide: BillingCycleService, useValue: billingCycleService },
        { provide: BillingManagementService, useValue: billingManagement },
        { provide: AuditService, useValue: { record: jest.fn(), findByModuleAndEntity: jest.fn() } },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        { provide: WorkflowOrchestrationService, useValue: { registerAutoApproveHandler: jest.fn(), startInstance: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(BillRunService);
  });

  it('a historical completed period with no BillRun is reported as missing_bill_run', async () => {
    billingReadiness.evaluateHistoricalCycle.mockImplementation((propertyId: number, cycleVersionId: number) => {
      if (propertyId === 41 && cycleVersionId === 16) {
        return Promise.resolve(evaluatedResult({
          propertyId: 41, propertyName: 'Grand Tower A', cycleVersionId: 16,
          periodStart: '2026-09-25', periodEnd: '2026-09-30',
          eligibleForBilling: true, existingBillRun: null,
        }));
      }
      return Promise.resolve(evaluatedResult({ propertyId, propertyName: 'Other', cycleVersionId, periodStart: '2026-01-01', periodEnd: '2026-01-28' }));
    });

    const result = await service.getPastBillingOverview({ propertyId: 41, page: 1, limit: 20 } as any);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      propertyId: 41, cycleVersionId: 16, overviewStatus: 'missing_bill_run', existingBillRun: null, generatedBillCount: null,
    });
  });

  it('a blocked period (missing readings) is reported as blocked, with the real backend reason surfaced verbatim', async () => {
    billingReadiness.evaluateHistoricalCycle.mockImplementation((propertyId: number, cycleVersionId: number) => {
      if (propertyId === 65 && cycleVersionId === 19) {
        return Promise.resolve(evaluatedResult({
          propertyId: 65, propertyName: 'Crest Tower A', cycleVersionId: 19,
          periodStart: '2026-09-03', periodEnd: '2026-09-27',
          eligibleForBilling: false,
          blockingReasons: ['25 of 25 required meter(s) do not have enough readings in this period to compute consumption'],
          existingBillRun: null,
        }));
      }
      return Promise.resolve(evaluatedResult({ propertyId, propertyName: 'Other', cycleVersionId, periodStart: '2026-01-01', periodEnd: '2026-01-28' }));
    });

    const result = await service.getPastBillingOverview({ propertyId: 65, page: 1, limit: 20 } as any);

    expect(result.items[0].overviewStatus).toBe('blocked');
    expect(result.items[0].blockingReasons).toEqual(['25 of 25 required meter(s) do not have enough readings in this period to compute consumption']);
    // A blocked period is never silently treated as billable — no BillRun exists and none is implied.
    expect(result.items[0].existingBillRun).toBeNull();
  });

  it('an existing PENDING_APPROVAL BillRun for the period is reported as pending_approval, not missing', async () => {
    billingReadiness.evaluateHistoricalCycle.mockImplementation((propertyId: number, cycleVersionId: number) => {
      if (propertyId === 41 && cycleVersionId === 16) {
        return Promise.resolve(evaluatedResult({
          propertyId: 41, propertyName: 'Grand Tower A', cycleVersionId: 16,
          periodStart: '2026-09-25', periodEnd: '2026-09-30',
          eligibleForBilling: false,
          blockingReasons: ['A bill run (BR-000120) already exists for this property and cycle version — status: pending_approval'],
          existingBillRun: { id: 120, businessCode: 'BR-000120', status: 'pending_approval' },
        }));
      }
      return Promise.resolve(evaluatedResult({ propertyId, propertyName: 'Other', cycleVersionId, periodStart: '2026-01-01', periodEnd: '2026-01-28' }));
    });

    const result = await service.getPastBillingOverview({ propertyId: 41, page: 1, limit: 20 } as any);

    expect(result.items[0].overviewStatus).toBe('pending_approval');
    expect(result.items[0].existingBillRun).toEqual({ id: 120, businessCode: 'BR-000120', status: 'pending_approval' });
    // Approval status alone never implies Bills exist — generatedBillCount stays null, not 0.
    expect(result.items[0].generatedBillCount).toBeNull();
    expect(billingManagement.getSummary).not.toHaveBeenCalled();
  });

  // Regression test for the exact bug this fix corrects: overviewStatus used to collapse every
  // non-approved existingBillRun into 'pending_approval' — a REJECTED historical bill run would
  // have displayed as "still awaiting approval," which could read as "action still needed" when the
  // real status is terminal.
  it('an existing REJECTED BillRun is reported as rejected, never collapsed into pending_approval', async () => {
    billingReadiness.evaluateHistoricalCycle.mockImplementation((propertyId: number, cycleVersionId: number) => {
      if (propertyId === 41 && cycleVersionId === 16) {
        return Promise.resolve(evaluatedResult({
          propertyId: 41, propertyName: 'Grand Tower A', cycleVersionId: 16,
          periodStart: '2026-09-25', periodEnd: '2026-09-30',
          eligibleForBilling: false,
          blockingReasons: ['A bill run (BR-000119) already exists for this property and cycle version — status: rejected'],
          existingBillRun: { id: 119, businessCode: 'BR-000119', status: 'rejected' },
        }));
      }
      return Promise.resolve(evaluatedResult({ propertyId, propertyName: 'Other', cycleVersionId, periodStart: '2026-01-01', periodEnd: '2026-01-28' }));
    });

    const result = await service.getPastBillingOverview({ propertyId: 41, page: 1, limit: 20 } as any);

    expect(result.items[0].overviewStatus).toBe('rejected');
    expect(result.items[0].overviewStatus).not.toBe('pending_approval');
    expect(result.items[0].generatedBillCount).toBeNull();
  });

  it('an existing RETURNED_FOR_CORRECTION BillRun is reported as returned_for_correction, never collapsed into pending_approval', async () => {
    billingReadiness.evaluateHistoricalCycle.mockImplementation((propertyId: number, cycleVersionId: number) => {
      if (propertyId === 41 && cycleVersionId === 16) {
        return Promise.resolve(evaluatedResult({
          propertyId: 41, propertyName: 'Grand Tower A', cycleVersionId: 16,
          periodStart: '2026-09-25', periodEnd: '2026-09-30',
          eligibleForBilling: false,
          blockingReasons: ['A bill run (BR-000118) already exists for this property and cycle version — status: returned_for_correction'],
          existingBillRun: { id: 118, businessCode: 'BR-000118', status: 'returned_for_correction' },
        }));
      }
      return Promise.resolve(evaluatedResult({ propertyId, propertyName: 'Other', cycleVersionId, periodStart: '2026-01-01', periodEnd: '2026-01-28' }));
    });

    const result = await service.getPastBillingOverview({ propertyId: 41, page: 1, limit: 20 } as any);

    expect(result.items[0].overviewStatus).toBe('returned_for_correction');
    expect(result.items[0].overviewStatus).not.toBe('pending_approval');
  });

  it('an existing APPROVED BillRun queries the real generated Bill count — never assumes approval means fully billed', async () => {
    billingReadiness.evaluateHistoricalCycle.mockImplementation((propertyId: number, cycleVersionId: number) => {
      if (propertyId === 41 && cycleVersionId === 16) {
        return Promise.resolve(evaluatedResult({
          propertyId: 41, propertyName: 'Grand Tower A', cycleVersionId: 16,
          periodStart: '2026-09-25', periodEnd: '2026-09-30',
          eligibleForBilling: false,
          existingBillRun: { id: 121, businessCode: 'BR-000121', status: 'approved' },
          units: Array.from({ length: 24 }, (_, i) => ({ unitId: i })),
        }));
      }
      return Promise.resolve(evaluatedResult({ propertyId, propertyName: 'Other', cycleVersionId, periodStart: '2026-01-01', periodEnd: '2026-01-28' }));
    });
    // Real persisted Bill count is LOWER than billableUnits — a partial-generation outcome that
    // approval status alone could never reveal.
    billingManagement.getSummary.mockResolvedValue({ totalBills: 19 });

    const result = await service.getPastBillingOverview({ propertyId: 41, page: 1, limit: 20 } as any);

    expect(result.items[0].overviewStatus).toBe('approved');
    expect(billingManagement.getSummary).toHaveBeenCalledWith({ billRunId: 121 });
    expect(result.items[0].generatedBillCount).toBe(19);
    expect(result.items[0].billableUnits).toBe(24);
  });

  it('cycle-version boundaries: a property with only an ACTIVE (current) version contributes zero historical rows — never misreported as a gap', async () => {
    billingCycleService.getHistoricalVersionsForProperty.mockImplementation((propertyId: number) =>
      Promise.resolve(propertyId === 41 ? [] : (HISTORICAL_VERSIONS[propertyId] ?? [])),
    );

    const result = await service.getPastBillingOverview({ propertyId: 41, page: 1, limit: 20 } as any);

    expect(result.items).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
  });

  it('periodFrom/periodTo filters exclude a historical version whose periodStart falls outside the range', async () => {
    const result = await service.getPastBillingOverview({ propertyId: 99, periodFrom: '2026-09-01', page: 1, limit: 20 } as any);

    // Property 99 has two historical versions (Aug and Sep) — only the September one's periodStart
    // (2026-09-01) is >= periodFrom; the August one (2026-08-01) must be excluded.
    expect(result.items.map((r) => r.cycleVersionId)).toEqual([31]);
  });

  it('overviewStatus filter narrows the result to exactly the requested status, after real evaluation — never a pre-filter guess', async () => {
    billingReadiness.evaluateHistoricalCycle.mockImplementation((propertyId: number, cycleVersionId: number) => {
      if (propertyId === 41 && cycleVersionId === 16) {
        return Promise.resolve(evaluatedResult({ propertyId: 41, propertyName: 'Grand Tower A', cycleVersionId: 16, periodStart: '2026-09-25', periodEnd: '2026-09-30', eligibleForBilling: true }));
      }
      if (propertyId === 65 && cycleVersionId === 19) {
        return Promise.resolve(evaluatedResult({ propertyId: 65, propertyName: 'Crest Tower A', cycleVersionId: 19, periodStart: '2026-09-03', periodEnd: '2026-09-27', eligibleForBilling: false, blockingReasons: ['missing readings'] }));
      }
      return Promise.resolve(evaluatedResult({ propertyId, propertyName: 'Other', cycleVersionId, periodStart: '2026-01-01', periodEnd: '2026-01-28' }));
    });

    const result = await service.getPastBillingOverview({ overviewStatus: 'blocked' as any, page: 1, limit: 20 } as any);

    expect(result.items.every((r) => r.overviewStatus === 'blocked')).toBe(true);
    expect(result.items.some((r) => r.propertyId === 65)).toBe(true);
    expect(result.items.some((r) => r.propertyId === 41)).toBe(false);
  });

  it('pagination: total reflects the full filtered set, items reflects only the requested page/limit', async () => {
    const page1 = await service.getPastBillingOverview({ page: 1, limit: 2 } as any);
    const page2 = await service.getPastBillingOverview({ page: 2, limit: 2 } as any);

    // 4 total candidate rows across MASTER_ROWS/HISTORICAL_VERSIONS (1 + 1 + 2), all eligible by the
    // default mock — total must reflect all of them regardless of page size.
    expect(page1.pagination.total).toBe(4);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    // No row appears on both pages.
    const page1Keys = page1.items.map((r) => `${r.propertyId}:${r.cycleVersionId}`);
    const page2Keys = page2.items.map((r) => `${r.propertyId}:${r.cycleVersionId}`);
    expect(page1Keys.some((k) => page2Keys.includes(k))).toBe(false);
  });

  it('newest completed period sorts first', async () => {
    const result = await service.getPastBillingOverview({ propertyId: 99, page: 1, limit: 20 } as any);

    // Property 99's September version (periodStart 2026-09-01) must sort before its August version
    // (periodStart 2026-08-01) — newest first, per the feature's own stated requirement.
    expect(result.items.map((r) => r.cycleVersionId)).toEqual([31, 30]);
  });
});

describe('BillRunService.getPastBillingOverviewSummary', () => {
  it('derives real counts from the same evaluation getPastBillingOverview uses — never a separate, possibly-divergent approximation', async () => {
    const billingCycleMastersRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { propertyId: 41, propertyName: 'Grand Tower A', propertyCode: 'AZG-T01', communityId: 14, communityName: 'Azizi Grand' },
        ]),
      }),
    };
    const billingCycleService = {
      getHistoricalVersionsForProperty: jest.fn().mockResolvedValue([
        { versionId: 16, masterId: 9, periodStart: '2026-09-25', periodEnd: '2026-09-30', effectiveFrom: '2026-09-25', deprecatedOn: '2026-09-28', ageDays: 17 },
      ]),
    };
    const billingReadiness = {
      evaluateHistoricalCycle: jest.fn().mockResolvedValue({
        propertyId: 41, propertyName: 'Grand Tower A', propertyCode: null, cycleVersionId: 16,
        periodStart: '2026-09-25', periodEnd: '2026-09-30', ageDays: 17,
        eligibleForBilling: true, blockingReasons: [], missingReadingMeterIds: [],
        existingBillRun: null, units: [],
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillRunService,
        { provide: getRepositoryToken(BillRun), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(BillRunBatch), useValue: { findOne: jest.fn(), find: jest.fn() } },
        { provide: getRepositoryToken(Property), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(MeterReading), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(BillingCycleMaster), useValue: billingCycleMastersRepo },
        { provide: BillingReadinessService, useValue: billingReadiness },
        { provide: BillingCycleService, useValue: billingCycleService },
        { provide: BillingManagementService, useValue: { getSummary: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn(), findByModuleAndEntity: jest.fn() } },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        { provide: WorkflowOrchestrationService, useValue: { registerAutoApproveHandler: jest.fn(), startInstance: jest.fn() } },
      ],
    }).compile();

    const service = moduleRef.get(BillRunService);
    const summary = await service.getPastBillingOverviewSummary({});

    expect(summary).toEqual({
      missingBillRun: 1, blocked: 0, pendingApproval: 0, approved: 0,
      returnedForCorrection: 0, rejected: 0, totalPeriods: 1,
    });
  });
});

// BillRunService.approve() — closes a confirmed gap: this method's own isFinalLevel branch (the
// exact logic a real multi-level-approval bug report hinges on) had ZERO test coverage before this.
// Mocks WorkflowOrchestrationService.assertCanAct/recordApproval directly (never a real
// WorkflowInstance/WorkflowDefinitionLevel row) — isFinalLevel is the one field this method reads
// from assertCanAct's return value, so controlling it directly is the correct, minimal way to
// exercise both branches without standing up the whole workflow engine.
describe('BillRunService.approve', () => {
  let service: BillRunService;
  let billRunsRepo: { createQueryBuilder: jest.Mock; findOne: jest.Mock };
  let workflowOrchestration: { assertCanAct: jest.Mock; recordApproval: jest.Mock; registerAutoApproveHandler: jest.Mock };
  let billingManagement: { generateBillsForBillRun: jest.Mock };
  let auditService: { record: jest.Mock };
  let manager: { createQueryBuilder: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const PENDING_BILL_RUN = {
    id: 19,
    businessCode: 'BLR-000019',
    propertyId: 41,
    cycleVersionId: 22,
    status: BillRunStatus.PENDING_APPROVAL,
    submittedById: 7, // different from actorId (11) below — assertNotSelfReview must not fire
    billableUnits: 24,
  } as BillRun;

  function qbStubFor(result: BillRun | null) {
    return {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(result),
    };
  }

  beforeEach(async () => {
    billRunsRepo = { createQueryBuilder: jest.fn(), findOne: jest.fn() };
    workflowOrchestration = {
      assertCanAct: jest.fn(),
      recordApproval: jest.fn().mockResolvedValue(undefined),
      registerAutoApproveHandler: jest.fn(),
    };
    billingManagement = { generateBillsForBillRun: jest.fn().mockResolvedValue({ created: [], failed: [] }) };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    manager = {
      createQueryBuilder: jest.fn().mockReturnValue(qbStubFor({ ...PENDING_BILL_RUN })),
      save: jest.fn().mockImplementation((_entity, data) => Promise.resolve({ ...data })),
    };
    dataSource = { transaction: jest.fn().mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(manager)) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillRunService,
        { provide: getRepositoryToken(BillRun), useValue: billRunsRepo },
        { provide: getRepositoryToken(BillRunBatch), useValue: { findOne: jest.fn(), find: jest.fn() } },
        { provide: getRepositoryToken(Property), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(MeterReading), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(BillingCycleMaster), useValue: { createQueryBuilder: jest.fn() } },
        { provide: BillingReadinessService, useValue: { getReadiness: jest.fn(), evaluateHistoricalCycle: jest.fn(), checkRecoveredReadingEligibility: jest.fn() } },
        { provide: BillingCycleService, useValue: { getReadingPeriodForProperty: jest.fn(), getHistoricalVersionsForProperty: jest.fn() } },
        { provide: BillingManagementService, useValue: billingManagement },
        { provide: AuditService, useValue: auditService },
        { provide: DataSource, useValue: dataSource },
        { provide: WorkflowOrchestrationService, useValue: workflowOrchestration },
      ],
    }).compile();

    service = moduleRef.get(BillRunService);
    // findOne() re-fetches with relations after the transaction commits — stub it to return
    // whatever manager.save last produced, same convention as the submit() tests above.
    jest.spyOn(service, 'findOne').mockImplementation(() =>
      Promise.resolve(manager.save.mock.results[0]?.value as unknown as Promise<BillRun>),
    );
  });

  it('level 1 of 2 (isFinalLevel=false): BillRun status stays PENDING_APPROVAL, bill generation never runs', async () => {
    workflowOrchestration.assertCanAct.mockResolvedValue({ instance: { id: 501 }, isFinalLevel: false });

    const result = await service.approve(19, {}, 11);

    expect(result.status).toBe(BillRunStatus.PENDING_APPROVAL);
    expect(manager.save).toHaveBeenCalledWith(BillRun, expect.objectContaining({ status: BillRunStatus.PENDING_APPROVAL }));
    expect(workflowOrchestration.recordApproval).toHaveBeenCalledTimes(1);
    expect(billingManagement.generateBillsForBillRun).not.toHaveBeenCalled();
  });

  it('level 2 of 2 / final level (isFinalLevel=true): BillRun status becomes APPROVED, bill generation runs exactly once', async () => {
    workflowOrchestration.assertCanAct.mockResolvedValue({ instance: { id: 501 }, isFinalLevel: true });

    const result = await service.approve(19, {}, 11);

    expect(result.status).toBe(BillRunStatus.APPROVED);
    expect(manager.save).toHaveBeenCalledWith(BillRun, expect.objectContaining({ status: BillRunStatus.APPROVED }));
    expect(billingManagement.generateBillsForBillRun).toHaveBeenCalledTimes(1);
    expect(billingManagement.generateBillsForBillRun).toHaveBeenCalledWith(19, 11);
  });

  it('no workflow configured (assertCanAct returns instance: null, isFinalLevel: true) behaves exactly like a single-level approval — the backward-compatibility contract', async () => {
    workflowOrchestration.assertCanAct.mockResolvedValue({ instance: null, isFinalLevel: true });

    const result = await service.approve(19, {}, 11);

    expect(result.status).toBe(BillRunStatus.APPROVED);
    expect(billingManagement.generateBillsForBillRun).toHaveBeenCalledTimes(1);
  });

  it('a non-pending BillRun (already approved/rejected) is refused regardless of workflow level', async () => {
    manager.createQueryBuilder.mockReturnValue(qbStubFor({ ...PENDING_BILL_RUN, status: BillRunStatus.APPROVED }));
    workflowOrchestration.assertCanAct.mockResolvedValue({ instance: { id: 501 }, isFinalLevel: false });

    await expect(service.approve(19, {}, 11)).rejects.toThrow(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('bill generation failing after a final approval does not make approve() itself throw — approval already committed', async () => {
    workflowOrchestration.assertCanAct.mockResolvedValue({ instance: { id: 501 }, isFinalLevel: true });
    billingManagement.generateBillsForBillRun.mockRejectedValue(new Error('generation blew up'));

    const result = await service.approve(19, {}, 11);

    expect(result.status).toBe(BillRunStatus.APPROVED);
  });
});
