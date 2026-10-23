import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BillingReadinessService } from './billing-readiness.service';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { BillRun } from '../bill-run/entities/bill-run.entity';
import { BillingCycleService } from '../billing-cycle/billing-cycle.service';
import { TariffService } from '../tariff/tariff.service';
import { CustomerService } from '../customer/customer.service';

// Isolated unit tests for evaluateHistoricalCycle — every dependency mocked, no real database
// connection. Grand Tower A's real shape (24 units, SMT-AZG-003 the only unit with a reading) is
// mirrored as synthetic fixture data to exercise the readiness/eligibility checks without reading
// from or writing to the real dev/production database.
//
// IMPORTANT, confirmed via a live check against the real database: Grand Tower A's real 2026-09-28
// data has exactly 1 reading per unit in the Sep 27-30 window — including SMT-AZG-003 — never 2.
// calculateConsumption (BillingManagementService) needs an OPENING and a CLOSING reading in-window
// to compute a diff; with exactly 1, there is nothing to diff against. The OLD version of this
// fixture (and the OLD `>0` presence check this file used to test) treated 1 reading as
// "qualifying," which is why the real system briefly reported eligibleForBilling=true for a period
// that would have generated ZERO real Bills on approval. The fixture below therefore uses count: 2
// for the "qualifying" unit, not 1 — this is what GENUINELY qualifying looks like, matching what
// generation itself actually requires. See billing-readiness.service.ts's own
// MIN_QUALIFYING_READINGS_PER_UNIT doc comment for the full explanation.

function makeUnit(id: number, unitNumber: string) {
  return { id, unitNumber, status: 'active' } as unknown as Unit;
}

function qbStub(rows: Array<{ unitId: number; count: string }>) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
}

describe('BillingReadinessService.evaluateHistoricalCycle', () => {
  let service: BillingReadinessService;
  let propertiesRepo: { findOne: jest.Mock };
  let unitsRepo: { find: jest.Mock };
  let subMetersRepo: { find: jest.Mock };
  let meterReadingsRepo: { createQueryBuilder: jest.Mock };
  let billRunsRepo: { findOne: jest.Mock };
  let billingCycleService: { getHistoricalVersionsForProperty: jest.Mock; getReadingPeriodForProperty: jest.Mock };
  let tariffService: { resolveForUnitsAsOf: jest.Mock };
  let customerService: { findByUnitIds: jest.Mock; resolveCurrentCustomer: jest.Mock };

  const HISTORICAL_VERSION = {
    versionId: 16,
    masterId: 9,
    periodStart: '2026-09-25',
    periodEnd: '2026-09-30',
    effectiveFrom: '2026-09-25',
    deprecatedOn: '2026-09-28',
    ageDays: 16,
  };

  // 24 units: unit 2050 has the one qualifying reading (SMT-AZG-003), the other 23 do not.
  const ALL_UNITS = Array.from({ length: 24 }, (_, i) => makeUnit(2048 + i, `AZG-T01-${String(i + 1).padStart(2, '0')}`));
  const SUB_METER_MAP = new Map(
    ALL_UNITS.map((u, i) => [u.id, { unit: u, businessCode: `SMT-AZG-${String(i + 1).padStart(3, '0')}` } as unknown as SubMeter]),
  );

  beforeEach(async () => {
    propertiesRepo = { findOne: jest.fn().mockResolvedValue({ id: 41, name: 'Grand Tower A', businessCode: 'PRP-000041', community: { id: 14, name: 'Azizi Grand' } }) };
    unitsRepo = { find: jest.fn().mockResolvedValue(ALL_UNITS) };
    subMetersRepo = { find: jest.fn().mockResolvedValue(Array.from(SUB_METER_MAP.values())) };
    meterReadingsRepo = { createQueryBuilder: jest.fn() };
    billRunsRepo = { findOne: jest.fn().mockResolvedValue(null) };
    billingCycleService = {
      getHistoricalVersionsForProperty: jest.fn().mockResolvedValue([HISTORICAL_VERSION]),
      // Returns null (no current cycle) by default — only consulted when the requested
      // cycleVersionId isn't found in the DEPRECATED list; most tests here request version 16
      // (which IS in that list), so this fallback path is only exercised by the
      // "not a valid historical version" test below, which deliberately empties the DEPRECATED
      // list and expects this to ALSO fail to match, proving the block fires correctly either way.
      getReadingPeriodForProperty: jest.fn().mockResolvedValue(null),
    };
    tariffService = {
      resolveForUnitsAsOf: jest.fn().mockResolvedValue(
        new Map(ALL_UNITS.map((u) => [u.id, { id: 26, status: 'active', effectiveFrom: '2026-01-01', effectiveTo: null }])),
      ),
    };
    customerService = {
      findByUnitIds: jest.fn().mockResolvedValue(
        new Map([[2050, [{ id: 68, businessCode: 'CUS-000068', fullName: 'Test Tenant', residentType: 'tenant', accountStatus: 'active' }]]]),
      ),
      resolveCurrentCustomer: jest.fn().mockImplementation((unitCustomers: any[]) => ({
        currentCustomer: unitCustomers[0] ?? null,
        currentCustomerType: unitCustomers[0]?.residentType ?? null,
        owner: null,
        tenant: unitCustomers[0] ?? null,
        ownerMissing: false,
      })),
    };

    // Only unit 2050 (index 2, meter SMT-AZG-003) has enough readings (2 — an opening and a
    // closing) to qualify. count: 2, not 1 — see this file's own top-of-file doc comment on why 1
    // is deliberately NOT treated as qualifying.
    meterReadingsRepo.createQueryBuilder.mockReturnValue(qbStub([{ unitId: 2050, count: '2' }]));

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingReadinessService,
        { provide: getRepositoryToken(Property), useValue: propertiesRepo },
        { provide: getRepositoryToken(Unit), useValue: unitsRepo },
        { provide: getRepositoryToken(SubMeter), useValue: subMetersRepo },
        { provide: getRepositoryToken(MeterReading), useValue: meterReadingsRepo },
        { provide: getRepositoryToken(BillRun), useValue: billRunsRepo },
        { provide: BillingCycleService, useValue: billingCycleService },
        { provide: TariffService, useValue: tariffService },
        { provide: CustomerService, useValue: customerService },
      ],
    }).compile();

    service = moduleRef.get(BillingReadinessService);
  });

  it('throws NotFoundException for an unknown property', async () => {
    propertiesRepo.findOne.mockResolvedValue(null);
    await expect(service.evaluateHistoricalCycle(999, 16)).rejects.toThrow(NotFoundException);
  });

  it('blocks (never silently resolves) when the cycle version id is NEITHER a valid deprecated version NOR the current one', async () => {
    billingCycleService.getHistoricalVersionsForProperty.mockResolvedValue([]); // version 16 not found
    // getReadingPeriodForProperty already defaults to null in this describe block's own beforeEach
    // (no current cycle configured) — so version 16 is unresolvable via EITHER path, correctly
    // blocking rather than guessing.
    const result = await service.evaluateHistoricalCycle(41, 16);
    expect(result.eligibleForBilling).toBe(false);
    expect(result.blockingReasons[0]).toMatch(/not a valid historical or current version/i);
    expect(result.units).toHaveLength(0);
  });

  it('resolves via the CURRENT-version fallback when the requested id is not in the DEPRECATED list but IS the property\'s real current version', async () => {
    // The exact real Grand Tower A case: version 22 is ACTIVE (not DEPRECATED), so it's absent from
    // getHistoricalVersionsForProperty's own list — but getReadingPeriodForProperty correctly
    // resolves it as the property's current cycle, and this method must recognize that as valid
    // rather than blocking.
    billingCycleService.getHistoricalVersionsForProperty.mockResolvedValue([]); // 22 not in the DEPRECATED list
    billingCycleService.getReadingPeriodForProperty.mockResolvedValue({
      closed: true, periodStart: '2026-09-27', periodEnd: '2026-09-30', masterId: 9, versionId: 22,
      billGenerationDays: 1, billIssueDays: 2, billDueDays: 21,
    });

    const result = await service.evaluateHistoricalCycle(41, 22);

    expect(result.cycleVersionId).toBe(22);
    expect(result.periodStart).toBe('2026-09-27');
    expect(result.periodEnd).toBe('2026-09-30');
    expect(result.units).toHaveLength(24); // Real readiness evaluation ran, not the invalid-version block.
    expect(result.blockingReasons).not.toContain(expect.stringMatching(/not a valid/i));
  });

  it('identifies exactly 1 of 24 units with enough readings to compute consumption and lists the other 23 by meter id', async () => {
    const result = await service.evaluateHistoricalCycle(41, 16);

    expect(result.propertyName).toBe('Grand Tower A');
    expect(result.propertyCode).toBe('PRP-000041');
    expect(result.periodStart).toBe('2026-09-25');
    expect(result.periodEnd).toBe('2026-09-30');
    expect(result.units).toHaveLength(24);

    const qualifying = result.units.filter((u) => u.hasQualifyingReading);
    expect(qualifying).toHaveLength(1);
    expect(qualifying[0].meterBusinessCode).toBe('SMT-AZG-003');

    expect(result.missingReadingMeterIds).toHaveLength(23);
    expect(result.missingReadingMeterIds.some((m) => m.startsWith('SMT-AZG-003'))).toBe(false);
  });

  it('a unit with exactly 1 reading (an opening, no closing) is reported as missing, not qualifying — the real Grand Tower A gap', async () => {
    // Confirmed live: this is the real Grand Tower A case. 1 reading is NOT enough to compute
    // consumption — calculateConsumption needs an opening AND a closing reading in-window.
    meterReadingsRepo.createQueryBuilder.mockReturnValue(qbStub([{ unitId: 2050, count: '1' }]));
    const result = await service.evaluateHistoricalCycle(41, 16);

    const unit2050 = result.units.find((u) => u.unitId === 2050)!;
    expect(unit2050.hasQualifyingReading).toBe(false);
    expect(result.missingReadingMeterIds.some((m) => m.startsWith('SMT-AZG-003') && /only 1 reading/i.test(m))).toBe(true);
    expect(result.eligibleForBilling).toBe(false);
  });

  it('reports eligibleForBilling=false when any required reading is missing — never assumes zero consumption', async () => {
    const result = await service.evaluateHistoricalCycle(41, 16);
    expect(result.eligibleForBilling).toBe(false);
    expect(result.blockingReasons.some((r) => /do not have enough readings in this period to compute consumption/i.test(r))).toBe(true);
  });

  it('eligibleForBilling becomes true only when every unit has enough readings, resolved tariff, and no existing run', async () => {
    meterReadingsRepo.createQueryBuilder.mockReturnValue(
      qbStub(ALL_UNITS.map((u) => ({ unitId: u.id, count: '2' }))),
    );
    customerService.findByUnitIds.mockResolvedValue(
      new Map(ALL_UNITS.map((u) => [u.id, [{ id: 1, businessCode: 'CUS-1', fullName: 'X', residentType: 'tenant', accountStatus: 'active' }]])),
    );

    const result = await service.evaluateHistoricalCycle(41, 16);
    expect(result.eligibleForBilling).toBe(true);
    expect(result.blockingReasons).toHaveLength(0);
    expect(result.missingReadingMeterIds).toHaveLength(0);
  });

  it('never falls back to the current tariff — a no-match tariff result is reported as a blocking reason', async () => {
    tariffService.resolveForUnitsAsOf.mockResolvedValue(new Map(ALL_UNITS.map((u) => [u.id, null])));
    const result = await service.evaluateHistoricalCycle(41, 16);
    expect(result.eligibleForBilling).toBe(false);
    expect(result.blockingReasons.some((r) => /could not be unambiguously resolved/i.test(r))).toBe(true);
    expect(result.units.every((u) => u.tariffStatus === 'no_match')).toBe(true);
  });

  it('treats an ambiguous (overlapping) tariff match as a block, never a silent pick', async () => {
    tariffService.resolveForUnitsAsOf.mockResolvedValue(new Map(ALL_UNITS.map((u) => [u.id, 'ambiguous' as const])));
    const result = await service.evaluateHistoricalCycle(41, 16);
    expect(result.eligibleForBilling).toBe(false);
    expect(result.units.every((u) => u.tariffStatus === 'ambiguous')).toBe(true);
    expect(result.units.every((u) => u.tariffVersionId === null)).toBe(true);
  });

  it('surfaces a prior bill run for this exact version as a blocking reason, regardless of any historical flag', async () => {
    billRunsRepo.findOne.mockResolvedValue({ id: 77, businessCode: 'BLR-000077', status: 'approved' });
    const result = await service.evaluateHistoricalCycle(41, 16);
    expect(result.existingBillRun).toEqual({ id: 77, businessCode: 'BLR-000077', status: 'approved' });
    expect(result.eligibleForBilling).toBe(false);
    expect(result.blockingReasons.some((r) => /already exists for this property and cycle version/i.test(r))).toBe(true);
    // The query itself no longer filters by isHistorical — it reports ANY existing bill run for this
    // property+version, since there is only one Bill Run mechanism now, not a separate historical one.
    expect(billRunsRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { propertyId: 41, cycleVersionId: 16 } }),
    );
  });

  it('marks occupantVerificationRequired=true unconditionally for every unit (no point-in-time occupancy history exists)', async () => {
    const result = await service.evaluateHistoricalCycle(41, 16);
    expect(result.units.every((u) => u.occupantVerificationRequired === true)).toBe(true);
  });
});

// The PRIMARY Missed Reading Recovery entry point — driven by a reading's own date, never a
// manually-picked cycleVersionId. Reuses the exact same mocked dependencies/fixtures as the describe
// block above (same BillingReadinessService instance shape, same Grand Tower A 24-unit fixture), only
// adding resolveVersionForReadingDate to the mocked BillingCycleService — this method delegates every
// real readiness check straight to the already-exhaustively-tested evaluateHistoricalCycle above, so
// these tests focus on the date-resolution branching (resolved/none/ambiguous) it adds in front of it.
describe('BillingReadinessService.checkRecoveredReadingEligibility', () => {
  let service: BillingReadinessService;
  let propertiesRepo: { findOne: jest.Mock };
  let unitsRepo: { find: jest.Mock };
  let subMetersRepo: { find: jest.Mock };
  let meterReadingsRepo: { createQueryBuilder: jest.Mock };
  let billRunsRepo: { findOne: jest.Mock };
  let billingCycleService: { getHistoricalVersionsForProperty: jest.Mock; getReadingPeriodForProperty: jest.Mock; resolveVersionForReadingDate: jest.Mock };
  let tariffService: { resolveForUnitsAsOf: jest.Mock };
  let customerService: { findByUnitIds: jest.Mock; resolveCurrentCustomer: jest.Mock };

  // Exactly the real, CONFIRMED Grand Tower A resolution after Option A's parent-child fix: the
  // DEPRECATED-only getHistoricalVersionsForProperty list does NOT include version 16's own entry
  // here (it's a different version than what 2026-09-28 actually resolves to), and version 22 (the
  // one 2026-09-28 DOES resolve to) is ACTIVE, not DEPRECATED, so it's also absent from that list —
  // evaluateHistoricalCycle's own periodOverride path is exactly what handles this case correctly
  // (see that method's own doc comment): checkRecoveredReadingEligibility passes
  // resolveVersionForReadingDate's own resolved period through explicitly, so evaluateHistoricalCycle
  // never needs to look the version up in either the DEPRECATED list or the current-cycle fallback
  // for THIS call path — those two lookups remain exercised separately by the describe block above,
  // for the explicit-cycleVersionId (no override) entry point.
  const RESOLVED_VERSION_22 = {
    versionId: 22,
    masterId: 9,
    periodStart: '2026-09-27',
    periodEnd: '2026-09-30',
    effectiveFrom: '2026-09-26',
    deprecatedOn: null,
    ageDays: 16,
  };

  function makeUnit2(id: number, unitNumber: string) {
    return { id, unitNumber, status: 'active' } as unknown as Unit;
  }

  function qbStub2(rows: Array<{ unitId: number; count: string }>) {
    return {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    };
  }

  const ALL_UNITS_2 = Array.from({ length: 24 }, (_, i) => makeUnit2(2048 + i, `AZG-T01-${String(i + 1).padStart(2, '0')}`));

  beforeEach(async () => {
    propertiesRepo = { findOne: jest.fn().mockResolvedValue({ id: 41, name: 'Grand Tower A', businessCode: 'PRP-000041', community: { id: 14, name: 'Azizi Grand' } }) };
    unitsRepo = { find: jest.fn().mockResolvedValue(ALL_UNITS_2) };
    subMetersRepo = { find: jest.fn().mockResolvedValue(ALL_UNITS_2.map((u, i) => ({ unit: u, businessCode: `SMT-AZG-${String(i + 1).padStart(3, '0')}` } as unknown as SubMeter))) };
    // count: 2 (an opening and a closing) — the real minimum to qualify; see the describe block
  // above's own doc comment on why 1 reading, the real Grand Tower A value, must NOT qualify.
  meterReadingsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qbStub2([{ unitId: 2050, count: '2' }])) };
    billRunsRepo = { findOne: jest.fn().mockResolvedValue(null) };
    billingCycleService = {
      // Realistic: version 22 is ACTIVE in real data, so it is correctly ABSENT from the
      // DEPRECATED-only list — never present here, unlike an earlier version of this fixture which
      // accidentally included it and masked a real period-override bug (caught only by live-DB
      // verification, not this mock, until this fixture was corrected to match reality).
      getHistoricalVersionsForProperty: jest.fn().mockResolvedValue([]),
      // Deliberately returns OCTOBER dates — the version's CURRENT (today-anchored) period, NOT
      // September — so that any test relying on this instead of the explicit periodOverride would
      // visibly fail with the wrong month, proving the override is what's actually used.
      getReadingPeriodForProperty: jest.fn().mockResolvedValue({
        closed: true, periodStart: '2026-10-27', periodEnd: '2026-10-30', masterId: 9, versionId: 22,
        billGenerationDays: 1, billIssueDays: 2, billDueDays: 21,
      }),
      resolveVersionForReadingDate: jest.fn(),
    };
    tariffService = {
      resolveForUnitsAsOf: jest.fn().mockResolvedValue(
        new Map(ALL_UNITS_2.map((u) => [u.id, { id: 26, status: 'active', effectiveFrom: '2026-01-01', effectiveTo: null }])),
      ),
    };
    customerService = {
      findByUnitIds: jest.fn().mockResolvedValue(
        new Map([[2050, [{ id: 68, businessCode: 'CUS-000068', fullName: 'Test Tenant', residentType: 'tenant', accountStatus: 'active' }]]]),
      ),
      resolveCurrentCustomer: jest.fn().mockImplementation((unitCustomers: any[]) => ({
        currentCustomer: unitCustomers[0] ?? null,
        currentCustomerType: unitCustomers[0]?.residentType ?? null,
        owner: null,
        tenant: unitCustomers[0] ?? null,
        ownerMissing: false,
      })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingReadinessService,
        { provide: getRepositoryToken(Property), useValue: propertiesRepo },
        { provide: getRepositoryToken(Unit), useValue: unitsRepo },
        { provide: getRepositoryToken(SubMeter), useValue: subMetersRepo },
        { provide: getRepositoryToken(MeterReading), useValue: meterReadingsRepo },
        { provide: getRepositoryToken(BillRun), useValue: billRunsRepo },
        { provide: BillingCycleService, useValue: billingCycleService },
        { provide: TariffService, useValue: tariffService },
        { provide: CustomerService, useValue: customerService },
      ],
    }).compile();

    service = moduleRef.get(BillingReadinessService);
  });

  it('throws NotFoundException for an unknown property, before any date resolution runs', async () => {
    propertiesRepo.findOne.mockResolvedValue(null);
    await expect(service.checkRecoveredReadingEligibility(999, '2026-09-28')).rejects.toThrow(NotFoundException);
    expect(billingCycleService.resolveVersionForReadingDate).not.toHaveBeenCalled();
  });

  it('the exact Grand Tower A case: 2026-09-28 resolves to version 22 (never 16, never "ambiguous")', async () => {
    billingCycleService.resolveVersionForReadingDate.mockResolvedValue({
      versionId: 22, masterId: 9, periodStart: '2026-09-27', periodEnd: '2026-09-30',
    });

    const result = await service.checkRecoveredReadingEligibility(41, '2026-09-28');

    expect(billingCycleService.resolveVersionForReadingDate).toHaveBeenCalledWith(41, '2026-09-28');
    expect(result.resolution).toBe('resolved');
    expect(result.cycleVersionId).toBe(22);
    // The fixture's getReadingPeriodForProperty deliberately returns OCTOBER dates (version 22's
    // CURRENT, today-anchored period) — if the period override were silently ignored and
    // evaluateHistoricalCycle re-derived the period independently, these assertions would see
    // October, not September, and fail. This is the exact regression this session's own live-DB
    // verification caught once (before the periodOverride fix) — this test locks it in.
    expect(result.periodStart).toBe('2026-09-27');
    expect(result.periodEnd).toBe('2026-09-30');
    expect(billingCycleService.getReadingPeriodForProperty).not.toHaveBeenCalled();
    expect(billingCycleService.getHistoricalVersionsForProperty).not.toHaveBeenCalled();
    expect(result.readingDate).toBe('2026-09-28');
    // Delegates to evaluateHistoricalCycle for every real check — same 1-valid/23-missing shape.
    expect(result.units).toHaveLength(24);
    expect(result.missingReadingMeterIds).toHaveLength(23);
    expect(result.eligibleForBilling).toBe(false); // blocked by the 23 missing readings, same as before.
  });

  it('surfaces "none" explicitly when no version covers the reading date — never falls back to any cycle', async () => {
    billingCycleService.resolveVersionForReadingDate.mockResolvedValue('none');

    const result = await service.checkRecoveredReadingEligibility(41, '2020-01-01');

    expect(result.resolution).toBe('none');
    expect(result.cycleVersionId).toBeNull();
    expect(result.eligibleForBilling).toBe(false);
    expect(result.blockingReasons[0]).toMatch(/no billing-cycle version covers/i);
    expect(result.units).toHaveLength(0);
    // evaluateHistoricalCycle itself must never be reached for a 'none' resolution — there is no
    // version id to evaluate against.
    expect(propertiesRepo.findOne).toHaveBeenCalledTimes(1);
  });

  it('surfaces "ambiguous" explicitly when more than one version covers the reading date — never guesses', async () => {
    billingCycleService.resolveVersionForReadingDate.mockResolvedValue('ambiguous');

    const result = await service.checkRecoveredReadingEligibility(41, '2026-02-03');

    expect(result.resolution).toBe('ambiguous');
    expect(result.cycleVersionId).toBeNull();
    expect(result.eligibleForBilling).toBe(false);
    expect(result.blockingReasons[0]).toMatch(/more than one billing-cycle version/i);
    expect(result.units).toHaveLength(0);
  });

  it('a resolved version that already passed every check end-to-end has eligibleForBilling=true', async () => {
    billingCycleService.resolveVersionForReadingDate.mockResolvedValue({
      versionId: 22, masterId: 9, periodStart: '2026-09-27', periodEnd: '2026-09-30',
    });
    meterReadingsRepo.createQueryBuilder.mockReturnValue(
      qbStub2(ALL_UNITS_2.map((u) => ({ unitId: u.id, count: '2' }))),
    );
    customerService.findByUnitIds.mockResolvedValue(
      new Map(ALL_UNITS_2.map((u) => [u.id, [{ id: 1, businessCode: 'CUS-1', fullName: 'X', residentType: 'tenant', accountStatus: 'active' }]])),
    );

    const result = await service.checkRecoveredReadingEligibility(41, '2026-09-28');

    expect(result.resolution).toBe('resolved');
    expect(result.eligibleForBilling).toBe(true);
    expect(result.blockingReasons).toHaveLength(0);
  });
});
