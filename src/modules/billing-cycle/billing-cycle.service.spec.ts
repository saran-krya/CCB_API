import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BillingCycleService } from './billing-cycle.service';
import { BillingCycleMaster } from './entities/billing-cycle-master.entity';
import { BillingCycleVersion, BillingCycleStatus } from './entities/billing-cycle-version.entity';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { AuditService } from '../../audit/audit.service';
import { LovService } from '../lov/lov.service';
import { WorkflowOrchestrationService } from '../workflow/workflow-orchestration.service';

// Isolated unit tests for resolveVersionForReadingDate — every repository mocked, no real database
// connection. Grand Tower A's real shape (master id 9: version 16 deprecated 25-30 Sep with
// deprecatedOn=2026-09-28, children 21 [rejected, effectiveFrom 26 Sep] and 22 [active, effectiveFrom
// 26 Sep, 27-30 day-rule]) is mirrored as fixture data for the exact overlap this session's own
// live-DB verification surfaced and then confirmed resolved by Option A. A synthetic long-lived
// version is added separately since no such version exists in real data yet.
//
// The real implementation makes TWO distinct repository calls: `candidateVersions` (status-filtered
// to ACTIVE/DEPRECATED, no relations) and `allVersionsForMaster` (every status, with `parentVersion`
// loaded) for the child-derived bound. `mockVersionsRepo` below wires both from ONE fixture array —
// a version's `.parent` property (not a real entity field, just this test's own shorthand) is turned
// into a loaded `parentVersion: { id }` relation for the second call, keeping each test's fixture
// declaration simple and matching real id/parent relationships explicitly rather than duplicating
// the same data twice per test.

interface VersionFixture {
  id: number;
  status: BillingCycleStatus;
  readingStartDay: number;
  readingEndDay: number;
  effectiveFrom: string | null;
  deprecatedOn: string | null;
  parent?: number; // This test's own shorthand for parentVersionId — not a real entity field.
}

function makeVersion(f: Omit<VersionFixture, 'status' | 'readingStartDay' | 'readingEndDay'> & Partial<Pick<VersionFixture, 'status' | 'readingStartDay' | 'readingEndDay'>>): VersionFixture {
  return {
    status: BillingCycleStatus.ACTIVE,
    readingStartDay: 1,
    readingEndDay: 5,
    ...f,
  };
}

function mockVersionsRepo(fixtures: VersionFixture[]) {
  const candidateStatuses = new Set([BillingCycleStatus.ACTIVE, BillingCycleStatus.DEPRECATED]);
  const find = jest.fn().mockImplementation((query: any) => {
    // The implementation's first call filters by status (candidateVersions); its second call has
    // no status filter but requests the parentVersion relation (allVersionsForMaster). Distinguished
    // by the presence of `relations` in the query, matching the real code's own two distinct calls.
    if (query?.relations) {
      return Promise.resolve(
        fixtures.map((f) => ({
          id: f.id,
          status: f.status,
          effectiveFrom: f.effectiveFrom,
          parentVersion: f.parent != null ? { id: f.parent } : null,
        })),
      );
    }
    return Promise.resolve(
      fixtures
        .filter((f) => candidateStatuses.has(f.status))
        .map((f) => ({
          id: f.id,
          readingStartDay: f.readingStartDay,
          readingEndDay: f.readingEndDay,
          effectiveFrom: f.effectiveFrom,
          deprecatedOn: f.deprecatedOn,
        })),
    );
  });
  return { find };
}

describe('BillingCycleService.resolveVersionForReadingDate', () => {
  let service: BillingCycleService;
  let mastersRepo: { findOne: jest.Mock };
  let versionsRepo: { find: jest.Mock };

  async function buildService() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingCycleService,
        { provide: getRepositoryToken(BillingCycleMaster), useValue: mastersRepo },
        { provide: getRepositoryToken(BillingCycleVersion), useValue: versionsRepo },
        { provide: getRepositoryToken(Community), useValue: {} },
        { provide: getRepositoryToken(Property), useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: LovService, useValue: {} },
        { provide: WorkflowOrchestrationService, useValue: { registerAutoApproveHandler: jest.fn() } },
      ],
    }).compile();
    return moduleRef.get(BillingCycleService);
  }

  beforeEach(() => {
    mastersRepo = { findOne: jest.fn().mockResolvedValue({ id: 9, propertyId: 41 }) };
    versionsRepo = { find: jest.fn() };
  });

  it('returns "none" when no property/master exists', async () => {
    mastersRepo.findOne.mockResolvedValue(null);
    service = await buildService();
    const result = await service.resolveVersionForReadingDate(999, '2026-09-28');
    expect(result).toBe('none');
  });

  it('returns "none" when no version covers the date at all', async () => {
    Object.assign(versionsRepo, mockVersionsRepo([
      makeVersion({ id: 16, readingStartDay: 25, readingEndDay: 30, effectiveFrom: '2026-09-25', deprecatedOn: '2026-09-28', status: BillingCycleStatus.DEPRECATED }),
    ]));
    service = await buildService();
    const result = await service.resolveVersionForReadingDate(41, '2020-01-01');
    expect(result).toBe('none');
  });

  it('resolves a single version with NO children to its own deprecatedOn-bounded period', async () => {
    Object.assign(versionsRepo, mockVersionsRepo([
      makeVersion({ id: 16, readingStartDay: 25, readingEndDay: 30, effectiveFrom: '2026-09-25', deprecatedOn: '2026-09-28', status: BillingCycleStatus.DEPRECATED }),
    ]));
    service = await buildService();
    const result = await service.resolveVersionForReadingDate(41, '2026-09-26');
    expect(result).toEqual({ versionId: 16, masterId: 9, periodStart: '2026-09-25', periodEnd: '2026-09-30' });
  });

  it('matches at the exact periodStart boundary (inclusive)', async () => {
    Object.assign(versionsRepo, mockVersionsRepo([
      makeVersion({ id: 16, readingStartDay: 25, readingEndDay: 30, effectiveFrom: '2026-09-25', deprecatedOn: '2026-09-28', status: BillingCycleStatus.DEPRECATED }),
    ]));
    service = await buildService();
    const result = await service.resolveVersionForReadingDate(41, '2026-09-25');
    expect(result).toEqual({ versionId: 16, masterId: 9, periodStart: '2026-09-25', periodEnd: '2026-09-30' });
  });

  it('matches at the exact periodEnd boundary (inclusive), for a version with no child shortening its window', async () => {
    Object.assign(versionsRepo, mockVersionsRepo([
      makeVersion({ id: 16, readingStartDay: 25, readingEndDay: 30, effectiveFrom: '2026-09-25', deprecatedOn: '2026-09-28', status: BillingCycleStatus.DEPRECATED }),
    ]));
    service = await buildService();
    const result = await service.resolveVersionForReadingDate(41, '2026-09-27');
    expect(result).toEqual({ versionId: 16, masterId: 9, periodStart: '2026-09-25', periodEnd: '2026-09-30' });
  });

  it('returns "none" for a date at/after the version\'s own deprecatedOn when it has no live child', async () => {
    Object.assign(versionsRepo, mockVersionsRepo([
      makeVersion({ id: 16, readingStartDay: 25, readingEndDay: 30, effectiveFrom: '2026-09-25', deprecatedOn: '2026-09-28', status: BillingCycleStatus.DEPRECATED }),
    ]));
    service = await buildService();
    const result = await service.resolveVersionForReadingDate(41, '2026-09-28');
    expect(result).toBe('none');
  });

  // ===== Option A: parent-child transition, the exact Grand Tower A real-data case =====

  describe('Option A — effective end is the EARLIER of deprecatedOn and a live child\'s effectiveFrom', () => {
    // version 16: deprecated, deprecatedOn=2026-09-28 (STALE — the activation cron ran late).
    // version 21: child of 16, REJECTED — never took over anything, must be ignored.
    // version 22: child of 16, ACTIVE, effectiveFrom=2026-09-26 (the TRUE handover date) — EARLIER
    // than 16's own stale deprecatedOn, so Option A shortens 16's window to end at 2026-09-26.
    const GRAND_TOWER_A_FIXTURES: VersionFixture[] = [
      makeVersion({ id: 16, readingStartDay: 25, readingEndDay: 30, effectiveFrom: '2026-09-25', deprecatedOn: '2026-09-28', status: BillingCycleStatus.DEPRECATED }),
      makeVersion({ id: 21, readingStartDay: 26, readingEndDay: 30, effectiveFrom: '2026-09-26', deprecatedOn: null, status: BillingCycleStatus.REJECTED, parent: 16 }),
      makeVersion({ id: 22, readingStartDay: 27, readingEndDay: 30, effectiveFrom: '2026-09-26', deprecatedOn: null, status: BillingCycleStatus.ACTIVE, parent: 16 }),
    ];

    it('resolves 2026-09-28 (the real Grand Tower A overlap date) unambiguously to version 22, not 16 or "ambiguous"', async () => {
      Object.assign(versionsRepo, mockVersionsRepo(GRAND_TOWER_A_FIXTURES));
      service = await buildService();
      const result = await service.resolveVersionForReadingDate(41, '2026-09-28');
      expect(result).toEqual({ versionId: 22, masterId: 9, periodStart: '2026-09-27', periodEnd: '2026-09-30' });
    });

    it('still resolves 2026-09-25 to version 16 — before the child-derived handover date', async () => {
      Object.assign(versionsRepo, mockVersionsRepo(GRAND_TOWER_A_FIXTURES));
      service = await buildService();
      const result = await service.resolveVersionForReadingDate(41, '2026-09-25');
      expect(result).toEqual({ versionId: 16, masterId: 9, periodStart: '2026-09-25', periodEnd: '2026-09-30' });
    });

    it('the REJECTED sibling (version 21) is never itself resolvable, and never affects version 16\'s own window', async () => {
      Object.assign(versionsRepo, mockVersionsRepo(GRAND_TOWER_A_FIXTURES));
      service = await buildService();
      // version 21 (rejected) would, if it counted, also compute a 26-30 Sep period — but it must
      // never be a candidate itself (excluded by the ACTIVE/DEPRECATED status filter) and must
      // never be treated as "the" child that shortens version 16's window instead of version 22.
      const result = await service.resolveVersionForReadingDate(41, '2026-09-29');
      expect(result).toEqual({ versionId: 22, masterId: 9, periodStart: '2026-09-27', periodEnd: '2026-09-30' });
    });

    it('a version with NO children at all is bounded only by its own deprecatedOn (Option A is a no-op here)', async () => {
      Object.assign(versionsRepo, mockVersionsRepo([
        makeVersion({ id: 30, readingStartDay: 1, readingEndDay: 5, effectiveFrom: '2026-01-01', deprecatedOn: '2026-03-01', status: BillingCycleStatus.DEPRECATED }),
      ]));
      service = await buildService();
      const result = await service.resolveVersionForReadingDate(41, '2026-02-03');
      expect(result).toEqual({ versionId: 30, masterId: 9, periodStart: '2026-02-01', periodEnd: '2026-02-05' });
    });

    it('a child whose effectiveFrom is LATER than the parent\'s own deprecatedOn leaves deprecatedOn as the binding bound', async () => {
      // Inverse of the stale-deprecatedOn case: here deprecatedOn (2026-02-01) is EARLIER than the
      // child's effectiveFrom (2026-02-15) — e.g. an explicit manual deprecation that preceded the
      // next version's own scheduled start. The earlier of the two must still govern, which here is
      // deprecatedOn itself, not the child.
      Object.assign(versionsRepo, mockVersionsRepo([
        makeVersion({ id: 40, readingStartDay: 1, readingEndDay: 5, effectiveFrom: '2026-01-01', deprecatedOn: '2026-02-01', status: BillingCycleStatus.DEPRECATED }),
        makeVersion({ id: 41, readingStartDay: 1, readingEndDay: 5, effectiveFrom: '2026-02-15', deprecatedOn: null, status: BillingCycleStatus.ACTIVE, parent: 40 }),
      ]));
      service = await buildService();
      // 2026-02-03 is after deprecatedOn (Feb 1) but before the child's effectiveFrom (Feb 15) —
      // under Option A it must be excluded from version 40 (deprecatedOn governs here, and Feb 3 is
      // after it), and version 41's own window doesn't start until Feb 15, so this date belongs to
      // neither — 'none', never a guess.
      const result = await service.resolveVersionForReadingDate(41, '2026-02-03');
      expect(result).toBe('none');
    });

    it('multiple live children with DIFFERENT effectiveFrom dates on the SAME parent is a contradictory state — "ambiguous"', async () => {
      // A genuinely invalid data state this implementation must not silently resolve one way or the
      // other: two children of the same parent, both ACTIVE/DEPRECATED (i.e. both claim to have
      // actually gone live), with different effectiveFrom dates — the data itself disagrees about
      // when the parent was really superseded.
      Object.assign(versionsRepo, mockVersionsRepo([
        makeVersion({ id: 50, readingStartDay: 1, readingEndDay: 5, effectiveFrom: '2026-01-01', deprecatedOn: '2026-06-01', status: BillingCycleStatus.DEPRECATED }),
        makeVersion({ id: 51, readingStartDay: 1, readingEndDay: 5, effectiveFrom: '2026-03-01', deprecatedOn: null, status: BillingCycleStatus.DEPRECATED, parent: 50 }),
        makeVersion({ id: 52, readingStartDay: 1, readingEndDay: 5, effectiveFrom: '2026-04-01', deprecatedOn: null, status: BillingCycleStatus.ACTIVE, parent: 50 }),
      ]));
      service = await buildService();
      const result = await service.resolveVersionForReadingDate(41, '2026-02-03');
      expect(result).toBe('ambiguous');
    });

    it('multiple children with the SAME effectiveFrom date is not contradictory — resolves normally', async () => {
      // Two children both genuinely effective from the same date is not a contradiction (e.g. a
      // rejected duplicate submitted and corrected same-day, both somehow marked live — unusual but
      // not date-ambiguous) — the shared effectiveFrom value itself is what the window-end bound
      // uses, regardless of how many children share it.
      Object.assign(versionsRepo, mockVersionsRepo([
        makeVersion({ id: 60, readingStartDay: 1, readingEndDay: 5, effectiveFrom: '2026-01-01', deprecatedOn: '2026-06-01', status: BillingCycleStatus.DEPRECATED }),
        makeVersion({ id: 61, readingStartDay: 1, readingEndDay: 5, effectiveFrom: '2026-02-15', deprecatedOn: null, status: BillingCycleStatus.DEPRECATED, parent: 60 }),
        makeVersion({ id: 62, readingStartDay: 1, readingEndDay: 5, effectiveFrom: '2026-02-15', deprecatedOn: null, status: BillingCycleStatus.ACTIVE, parent: 60 }),
      ]));
      service = await buildService();
      const result = await service.resolveVersionForReadingDate(41, '2026-02-03');
      expect(result).toEqual({ versionId: 60, masterId: 9, periodStart: '2026-02-01', periodEnd: '2026-02-05' });
    });
  });

  it('resolves a still-ACTIVE version (deprecatedOn: null) whose window is open-ended, bounded only by today', async () => {
    // deprecatedOn: null means this version's live window extends to "today" with no fixed end —
    // effectiveFrom is set safely in the past (2020) so the target date (2021, well before the
    // real "now" this test runs under) is unambiguously within the open-ended window regardless of
    // when the test suite itself executes, keeping this test deterministic rather than depending on
    // the real system clock's relationship to any specific literal date.
    Object.assign(versionsRepo, mockVersionsRepo([
      makeVersion({ id: 22, readingStartDay: 1, readingEndDay: 5, effectiveFrom: '2020-01-01', deprecatedOn: null, status: BillingCycleStatus.ACTIVE }),
    ]));
    service = await buildService();
    const result = await service.resolveVersionForReadingDate(41, '2021-06-03');
    expect(result).toEqual({ versionId: 22, masterId: 9, periodStart: '2021-06-01', periodEnd: '2021-06-05' });
  });

  // A version that stayed current across SEVERAL calendar months must recur a distinct period each
  // month under the same version id — never only its first occurrence. No such version exists in
  // real data yet (every live version is under 20 days old), so this is a synthetic fixture proving
  // the monthly-recurrence fix itself, which a naive "anchor once to effectiveFrom" implementation
  // would fail (it would only ever find the version's very first month).
  describe('long-lived version spanning multiple months', () => {
    const LONG_LIVED = makeVersion({
      id: 70,
      readingStartDay: 1,
      readingEndDay: 5,
      effectiveFrom: '2026-01-01',
      deprecatedOn: '2026-06-01', // Deprecated after 5 full months live.
      status: BillingCycleStatus.DEPRECATED,
    });

    it('resolves a reading date in the FIRST live month', async () => {
      Object.assign(versionsRepo, mockVersionsRepo([LONG_LIVED]));
      service = await buildService();
      const result = await service.resolveVersionForReadingDate(41, '2026-01-03');
      expect(result).toEqual({ versionId: 70, masterId: 9, periodStart: '2026-01-01', periodEnd: '2026-01-05' });
    });

    it('resolves a reading date in the FOURTH live month — proving recurrence, not a single anchor', async () => {
      Object.assign(versionsRepo, mockVersionsRepo([LONG_LIVED]));
      service = await buildService();
      const result = await service.resolveVersionForReadingDate(41, '2026-04-03');
      expect(result).toEqual({ versionId: 70, masterId: 9, periodStart: '2026-04-01', periodEnd: '2026-04-05' });
    });

    it('resolves a reading date in the LAST live month, before deprecation', async () => {
      Object.assign(versionsRepo, mockVersionsRepo([LONG_LIVED]));
      service = await buildService();
      const result = await service.resolveVersionForReadingDate(41, '2026-05-04');
      expect(result).toEqual({ versionId: 70, masterId: 9, periodStart: '2026-05-01', periodEnd: '2026-05-05' });
    });

    it('returns "none" for a month after deprecation, even though the day-rule alone would compute a period', async () => {
      Object.assign(versionsRepo, mockVersionsRepo([LONG_LIVED]));
      service = await buildService();
      // June 1-5 would be a mathematically valid period under the same day-rule, but the version
      // was deprecated exactly on 2026-06-01 — its window is exclusive of that date, so no period
      // in June (or later) belongs to it.
      const result = await service.resolveVersionForReadingDate(41, '2026-06-03');
      expect(result).toBe('none');
    });

    it('returns "none" for a month before effectiveFrom, even though the day-rule alone would compute a period', async () => {
      Object.assign(versionsRepo, mockVersionsRepo([LONG_LIVED]));
      service = await buildService();
      const result = await service.resolveVersionForReadingDate(41, '2025-12-03');
      expect(result).toBe('none');
    });
  });

  it('excludes PENDING/REJECTED/INACTIVE versions entirely as candidates — they never had a real reading period in effect', async () => {
    Object.assign(versionsRepo, mockVersionsRepo([
      makeVersion({ id: 99, readingStartDay: 25, readingEndDay: 30, effectiveFrom: '2026-09-01', deprecatedOn: null, status: BillingCycleStatus.REJECTED }),
    ]));
    service = await buildService();
    const result = await service.resolveVersionForReadingDate(41, '2026-09-28');
    expect(result).toBe('none');
  });

  it('ignores a version with no effectiveFrom (never genuinely live) rather than crashing or guessing', async () => {
    Object.assign(versionsRepo, mockVersionsRepo([
      makeVersion({ id: 98, readingStartDay: 1, readingEndDay: 5, effectiveFrom: null, deprecatedOn: null, status: BillingCycleStatus.ACTIVE }),
    ]));
    service = await buildService();
    const result = await service.resolveVersionForReadingDate(41, '2026-09-28');
    expect(result).toBe('none');
  });
});
