import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TariffService } from './tariff.service';
import { TariffMaster } from './entities/tariff-master.entity';
import { TariffVersion, TariffStatus, TariffApplicability } from './entities/tariff-version.entity';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { AuditService } from '../../audit/audit.service';
import { AttributeService } from '../attribute/attribute.service';
import { LovService } from '../lov/lov.service';
import { WorkflowOrchestrationService } from '../workflow/workflow-orchestration.service';

// Isolated unit tests for resolveForUnitsAsOf — every dependency mocked, no real database
// connection. Only the query-building/precedence/ambiguity-detection logic is under test here;
// every other TariffService method's own dependencies (AttributeService, LovService, workflow
// registration) are provided as inert stubs since resolveForUnitsAsOf never calls them.

function makeVersion(id: number, overrides: Partial<TariffVersion> = {}): TariffVersion {
  return {
    id,
    status: TariffStatus.ACTIVE,
    applicability: TariffApplicability.UNIT,
    propertyType: 'residential',
    effectiveFrom: null,
    effectiveTo: null,
    units: [],
    properties: [],
    ...overrides,
  } as unknown as TariffVersion;
}

describe('TariffService.resolveForUnitsAsOf', () => {
  let service: TariffService;
  let unitRepo: { find: jest.Mock };
  let versionsRepo: { createQueryBuilder: jest.Mock };

  const UNIT = { id: 2050, property: { id: 41, propertyType: 'residential' } } as unknown as Unit;

  function qbReturning(versions: TariffVersion[]) {
    return {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(versions),
    };
  }

  beforeEach(async () => {
    unitRepo = { find: jest.fn().mockResolvedValue([UNIT]) };
    versionsRepo = { createQueryBuilder: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TariffService,
        { provide: getRepositoryToken(TariffMaster), useValue: {} },
        { provide: getRepositoryToken(TariffVersion), useValue: versionsRepo },
        { provide: getRepositoryToken(Property), useValue: {} },
        { provide: getRepositoryToken(Unit), useValue: unitRepo },
        { provide: DataSource, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: AttributeService, useValue: {} },
        { provide: LovService, useValue: {} },
        { provide: WorkflowOrchestrationService, useValue: { registerAutoApproveHandler: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(TariffService);
  });

  it('resolves a single unit-scoped version whose effective window covers the historical date', async () => {
    const version = makeVersion(26, { effectiveFrom: '2026-01-01', effectiveTo: null, units: [UNIT] });
    versionsRepo.createQueryBuilder
      .mockReturnValueOnce(qbReturning([version])) // unit-scoped
      .mockReturnValueOnce(qbReturning([])) // property-scoped
      .mockReturnValueOnce(qbReturning([])); // global-scoped

    const result = await service.resolveForUnitsAsOf([2050], '2026-09-28');
    expect(result.get(2050)).toEqual(version);
  });

  it('returns null when nothing matches at any scope tier (never falls back to the current tariff)', async () => {
    versionsRepo.createQueryBuilder
      .mockReturnValueOnce(qbReturning([]))
      .mockReturnValueOnce(qbReturning([]))
      .mockReturnValueOnce(qbReturning([]));

    const result = await service.resolveForUnitsAsOf([2050], '2026-09-28');
    expect(result.get(2050)).toBeNull();
  });

  it('returns "ambiguous" when more than one unit-scoped version covers the same historical date — never silently picks one', async () => {
    const versionA = makeVersion(10, { effectiveFrom: '2026-08-01', effectiveTo: '2026-10-01', units: [UNIT] });
    const versionB = makeVersion(11, { effectiveFrom: '2026-09-01', effectiveTo: null, units: [UNIT] });
    versionsRepo.createQueryBuilder
      .mockReturnValueOnce(qbReturning([versionA, versionB]))
      .mockReturnValueOnce(qbReturning([]))
      .mockReturnValueOnce(qbReturning([]));

    const result = await service.resolveForUnitsAsOf([2050], '2026-09-28');
    expect(result.get(2050)).toBe('ambiguous');
  });

  it('precedence: a unit-scoped match wins even when property/global matches also exist', async () => {
    const unitScoped = makeVersion(26, { effectiveFrom: '2026-01-01', effectiveTo: null, units: [UNIT] });
    const propertyScoped = makeVersion(27, {
      applicability: TariffApplicability.PROPERTY,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      properties: [{ id: 41 }] as any,
    });
    versionsRepo.createQueryBuilder
      .mockReturnValueOnce(qbReturning([unitScoped]))
      .mockReturnValueOnce(qbReturning([propertyScoped]))
      .mockReturnValueOnce(qbReturning([]));

    const result = await service.resolveForUnitsAsOf([2050], '2026-09-28');
    expect(result.get(2050)).toEqual(unitScoped);
  });

  it('falls through to property scope when no unit-scoped match exists', async () => {
    const propertyScoped = makeVersion(27, {
      applicability: TariffApplicability.PROPERTY,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      properties: [{ id: 41 }] as any,
    });
    versionsRepo.createQueryBuilder
      .mockReturnValueOnce(qbReturning([]))
      .mockReturnValueOnce(qbReturning([propertyScoped]))
      .mockReturnValueOnce(qbReturning([]));

    const result = await service.resolveForUnitsAsOf([2050], '2026-09-28');
    expect(result.get(2050)).toEqual(propertyScoped);
  });

  it('includes DEPRECATED and EXPIRED statuses in the historical match set (a tariff correct for a past period has very likely since been superseded)', async () => {
    const deprecatedVersion = makeVersion(5, { status: TariffStatus.DEPRECATED, effectiveFrom: '2026-01-01', effectiveTo: '2026-10-01', units: [UNIT] });
    versionsRepo.createQueryBuilder
      .mockReturnValueOnce(qbReturning([deprecatedVersion]))
      .mockReturnValueOnce(qbReturning([]))
      .mockReturnValueOnce(qbReturning([]));

    const result = await service.resolveForUnitsAsOf([2050], '2026-09-28');
    expect(result.get(2050)).toEqual(deprecatedVersion);
  });

  it('returns an empty map for an empty unitIds array without querying anything', async () => {
    const result = await service.resolveForUnitsAsOf([], '2026-09-28');
    expect(result.size).toBe(0);
    expect(unitRepo.find).not.toHaveBeenCalled();
  });
});
