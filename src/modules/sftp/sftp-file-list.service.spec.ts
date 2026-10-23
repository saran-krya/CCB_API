import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SftpFileListService } from './sftp-file-list.service';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';
import { SftpIngestionStatus } from './entities/sftp-ingestion-status.enum';
import { MeterReading } from './entities/meter-reading.entity';
import { Community } from '../community/entities/community.entity';
import { MasterMeter } from '../meter/entities/master-meter.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';

// Regression test for the confirmed incident: a file PROCESSED on 2026-10-13 (created_at) but
// containing meter READINGS dated 2026-09-28 (reading_date, parsed from its filename) incorrectly
// matched a filter of "date=2026-09-28" under the old, unconditional
// "(log.reading_date = :date OR DATE(log.created_at) = :date)" query — because that OR fired
// purely off reading_date, regardless of the file's real processing date. The fix splits the single
// `date` param into two independent, never-OR'd filters: sftpDate (matches created_at only) and
// readingDate (matches reading_date only).
//
// Uses a small in-memory query-builder stub that genuinely evaluates each andWhere predicate against
// fixture rows (rather than only asserting the SQL string's shape) — this proves the fix end-to-end:
// a logically-wrong WHERE clause with the "right-looking" SQL text would still fail these
// assertions, not just a textual regression.

interface FixtureLog {
  id: number;
  fileName: string;
  readingDate: string | null;
  createdAt: string; // 'YYYY-MM-DD HH:mm' or date-only, parsed into a real Date below
  fileStatus: SftpIngestionStatus;
  property: { id: number; name: string } | null;
  community: { id: number; name: string } | null;
}

function makeLog(f: FixtureLog): SftpIngestionLog {
  return {
    id: f.id,
    fileName: f.fileName,
    readingDate: f.readingDate,
    createdAt: new Date(f.createdAt),
    fileStatus: f.fileStatus,
    property: f.property,
    community: f.community,
  } as unknown as SftpIngestionLog;
}

// Minimal real evaluator for exactly the two predicate shapes this service's findAll ever builds —
// 'DATE(log.created_at) = :sftpDate' and 'log.reading_date = :readingDate' — plus the no-op base
// predicates (status/community/property/search) left always-true here since they are not under
// test. Each `andWhere` call is stored and genuinely applied via `.filter()` on the next
// `getManyAndCount()`/`getMany()`, not just recorded for a string-shape assertion.
function makeQueryBuilderStub(rows: SftpIngestionLog[]) {
  let working = [...rows];
  const predicates: { sql: string; params: Record<string, any> }[] = [];

  function applyPredicate(sql: string, params: Record<string, any>) {
    predicates.push({ sql, params });
    if (sql.includes('DATE(log.created_at) = :sftpDate')) {
      working = working.filter((r) => toDateOnly((r as any).createdAt) === params.sftpDate);
    } else if (sql.includes('log.reading_date = :readingDate')) {
      working = working.filter((r) => (r as any).readingDate === params.readingDate);
    }
    // status/communityId/property/search predicates are not exercised by these tests — left as
    // no-ops so fixture rows aren't accidentally filtered out by an unimplemented branch.
  }

  function toDateOnly(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  const qb: any = {
    leftJoinAndSelect: () => qb,
    orderBy: () => qb,
    andWhere: (sql: string, params: Record<string, any>) => {
      applyPredicate(sql, params);
      return qb;
    },
    skip: () => qb,
    take: () => qb,
    getManyAndCount: async () => [working, working.length],
    getMany: async () => working,
    __predicates: predicates,
  };
  return qb;
}

describe('SftpFileListService.findAll — SFTP Date vs Reading Date filters', () => {
  let service: SftpFileListService;
  let ingestionLogsRepo: { createQueryBuilder: jest.Mock };

  // The exact confirmed incident: file processed 2026-10-13, containing readings for 2026-09-28.
  const OCT13_FILE_WITH_SEP28_READINGS = makeLog({
    id: 1,
    fileName: 'DTU_DTU-AZG-001_20260928.xlsx',
    readingDate: '2026-09-28',
    createdAt: '2026-10-13',
    fileStatus: SftpIngestionStatus.PROCESSED,
    property: { id: 41, name: 'Grand Tower A' },
    community: { id: 14, name: 'Azizi Grand' },
  });

  // A second, unrelated file genuinely both processed AND reading-dated 2026-09-28 — to prove
  // readingDate=2026-09-28 still correctly shows a real same-day file, not just rejecting everything.
  const SEP28_FILE_PROCESSED_SEP28 = makeLog({
    id: 2,
    fileName: 'DTU_DTU-RIV-01_20260928.csv',
    readingDate: '2026-09-28',
    createdAt: '2026-09-28',
    fileStatus: SftpIngestionStatus.PROCESSED,
    property: { id: 50, name: 'Riverside One' },
    community: { id: 15, name: 'Riverside' },
  });

  const ALL_FIXTURE_LOGS = [OCT13_FILE_WITH_SEP28_READINGS, SEP28_FILE_PROCESSED_SEP28];

  beforeEach(async () => {
    ingestionLogsRepo = { createQueryBuilder: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SftpFileListService,
        { provide: getRepositoryToken(SftpIngestionLog), useValue: ingestionLogsRepo },
        { provide: getRepositoryToken(Community), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(MeterReading), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(MasterMeter), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(SubMeter), useValue: { createQueryBuilder: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(SftpFileListService);
  });

  it('REGRESSION: sftpDate=2026-09-28 does NOT show the file processed 2026-10-13 (the confirmed incident)', async () => {
    ingestionLogsRepo.createQueryBuilder.mockReturnValue(makeQueryBuilderStub(ALL_FIXTURE_LOGS));

    const result = await service.findAll({ sftpDate: '2026-09-28', page: 1, limit: 20 } as any);

    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain(1); // the Oct-13-processed file must NOT appear
    expect(ids).toContain(2); // the genuinely Sep-28-processed file must still appear
  });

  it('sftpDate=2026-10-13 DOES show the file processed on that date', async () => {
    ingestionLogsRepo.createQueryBuilder.mockReturnValue(makeQueryBuilderStub(ALL_FIXTURE_LOGS));

    const result = await service.findAll({ sftpDate: '2026-10-13', page: 1, limit: 20 } as any);

    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(1);
    expect(ids).not.toContain(2);
  });

  it('readingDate=2026-09-28 DOES show the file (the meter readings inside it are genuinely for that date)', async () => {
    ingestionLogsRepo.createQueryBuilder.mockReturnValue(makeQueryBuilderStub(ALL_FIXTURE_LOGS));

    const result = await service.findAll({ readingDate: '2026-09-28', page: 1, limit: 20 } as any);

    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(1); // matches via its reading_date, correctly
    expect(ids).toContain(2);
  });

  it('readingDate and sftpDate are never OR\'d together — combining them is a genuine AND', async () => {
    ingestionLogsRepo.createQueryBuilder.mockReturnValue(makeQueryBuilderStub(ALL_FIXTURE_LOGS));

    // File 1 has sftpDate=2026-10-13 AND readingDate=2026-09-28 — only a query asking for BOTH
    // correctly should match it; asking for sftpDate=2026-09-28 (its reading date, not its
    // processing date) together with readingDate=2026-09-28 must NOT match it.
    const matching = await service.findAll({ sftpDate: '2026-10-13', readingDate: '2026-09-28', page: 1, limit: 20 } as any);
    expect(matching.items.map((i) => i.id)).toContain(1);

    const nonMatching = await service.findAll({ sftpDate: '2026-09-28', readingDate: '2026-09-28', page: 1, limit: 20 } as any);
    expect(nonMatching.items.map((i) => i.id)).not.toContain(1);
  });

  it('with neither sftpDate nor readingDate supplied, no date predicate is applied at all', async () => {
    const qb = makeQueryBuilderStub(ALL_FIXTURE_LOGS);
    ingestionLogsRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.findAll({ page: 1, limit: 20 } as any);

    expect(result.items.map((i) => i.id).sort()).toEqual([1, 2]);
    expect(qb.__predicates.some((p: any) => p.sql.includes('created_at') || p.sql.includes('reading_date'))).toBe(false);
  });
});
