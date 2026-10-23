import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EstateSummaryService } from './estate-summary.service';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';
import { SftpIngestionStatus } from './entities/sftp-ingestion-status.enum';
import { SftpEstateSummary } from './entities/sftp-estate-summary.entity';
import { MeterReading } from './entities/meter-reading.entity';
import { MasterMeter } from '../meter/entities/master-meter.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';

// Regression test for the confirmed incident, at the Estate Summary dashboard's own aggregation
// level (separate from sftp-file-list.service.spec.ts, which covers the Files tab's live query):
// a file PROCESSED on 2026-10-13 but containing meter READINGS dated 2026-09-28 used to count
// toward 2026-09-28's dashboard summary (reading_date-first selection), not 2026-10-13's — even
// though the file was never actually uploaded on Sep 28. generateSummaryForDate now selects
// strictly by upload/processing date (created_at), matching the Files tab's SFTP Date filter.

function makeLog(overrides: Partial<SftpIngestionLog> & { id: number; createdAt: Date }): SftpIngestionLog {
  return {
    fileName: 'DTU_DTU-AZG-001_x.csv',
    readingDate: null,
    fileStatus: SftpIngestionStatus.PROCESSED,
    receivedMeterCount: 1,
    validReadingCount: 1,
    anomalyCount: 0,
    criticalAnomalyCount: 0,
    highAnomalyCount: 0,
    mediumAnomalyCount: 0,
    lowAnomalyCount: 0,
    processingStartedAt: overrides.createdAt,
    processingCompletedAt: overrides.createdAt,
    ...overrides,
  } as unknown as SftpIngestionLog;
}

function makeQueryBuilderStub(rows: SftpIngestionLog[]) {
  const qb: any = {
    where: (sql: string, params: Record<string, any>) => {
      qb.__filtered = evaluate(rows, sql, params);
      return qb;
    },
    getMany: async () => qb.__filtered ?? rows,
  };
  return qb;
}

function evaluate(rows: SftpIngestionLog[], sql: string, params: Record<string, any>): SftpIngestionLog[] {
  if (sql.includes('DATE(log.created_at) = :date')) {
    return rows.filter((r) => toDateOnly((r as any).createdAt) === params.date);
  }
  return rows;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe('EstateSummaryService.generateSummaryForDate — upload date vs reading date', () => {
  let service: EstateSummaryService;
  let ingestionLogsRepo: { createQueryBuilder: jest.Mock };
  let summariesRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let masterMetersRepo: { createQueryBuilder: jest.Mock };
  let subMetersRepo: { createQueryBuilder: jest.Mock };
  let meterReadingsRepo: { createQueryBuilder: jest.Mock };

  // The exact confirmed incident: file processed 2026-10-13, containing readings for 2026-09-28.
  const OCT13_FILE_WITH_SEP28_READINGS = makeLog({
    id: 1,
    fileName: 'DTU_DTU-AZG-001_20260928.xlsx',
    readingDate: '2026-09-28',
    createdAt: new Date('2026-10-13T18:01:00Z'),
    fileStatus: SftpIngestionStatus.PROCESSED,
    receivedMeterCount: 1,
    validReadingCount: 1,
  });

  const ALL_LOGS = [OCT13_FILE_WITH_SEP28_READINGS];

  function countQb(count: number) {
    return { where: () => ({ andWhere: () => ({ getRawOne: async () => ({ count: String(count) }) }) }), getCount: async () => count };
  }

  beforeEach(async () => {
    ingestionLogsRepo = { createQueryBuilder: jest.fn() };
    summariesRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data) => ({ ...data })),
      save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 1, ...data })),
    };
    masterMetersRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        // countRegisteredDtus: .where(...).getCount()
        where: () => ({ getCount: async () => 1 }),
        // sumExpectedMeters: .select(...).where(...).getRawMany()
        select: () => ({ where: () => ({ getRawMany: async () => [{ propertyId: 41 }] }) }),
      }),
    };
    subMetersRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: () => ({ where: () => ({ getRawOne: async () => ({ count: '24' }) }) }),
      }),
    };
    meterReadingsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: () => ({ where: () => ({ andWhere: () => ({ getRawOne: async () => ({ count: '1' }) }) }) }),
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EstateSummaryService,
        { provide: getRepositoryToken(SftpIngestionLog), useValue: ingestionLogsRepo },
        { provide: getRepositoryToken(SftpEstateSummary), useValue: summariesRepo },
        { provide: getRepositoryToken(MasterMeter), useValue: masterMetersRepo },
        { provide: getRepositoryToken(SubMeter), useValue: subMetersRepo },
        { provide: getRepositoryToken(MeterReading), useValue: meterReadingsRepo },
      ],
    }).compile();

    service = moduleRef.get(EstateSummaryService);
  });

  it('REGRESSION: generateSummaryForDate("2026-09-28") does NOT count the file processed 2026-10-13 (the confirmed incident)', async () => {
    ingestionLogsRepo.createQueryBuilder.mockReturnValue(makeQueryBuilderStub(ALL_LOGS));

    const summary = await service.generateSummaryForDate('2026-09-28');

    // Zero rows selected for Sep 28 (nothing was actually uploaded that day) — filesReceived must
    // be 0, never 1 the way the old reading_date-first selection would have counted it.
    expect(summary.filesReceived).toBe(0);
  });

  it('generateSummaryForDate("2026-10-13") DOES count the file actually processed on that date', async () => {
    ingestionLogsRepo.createQueryBuilder.mockReturnValue(makeQueryBuilderStub(ALL_LOGS));

    const summary = await service.generateSummaryForDate('2026-10-13');

    expect(summary.filesReceived).toBe(1);
  });

  it('never falls back to reading_date even when reading_date is populated — selection is created_at only, unconditionally', async () => {
    const qb = makeQueryBuilderStub(ALL_LOGS);
    ingestionLogsRepo.createQueryBuilder.mockReturnValue(qb);

    await service.generateSummaryForDate('2026-09-28');

    // The query builder stub only implements ONE where() call — confirms generateSummaryForDate no
    // longer calls .orWhere(...) at all (the old implementation chained .where(reading_date).orWhere(...)).
    expect(qb.getMany).toBeDefined();
    expect(typeof (qb as any).orWhere).toBe('undefined');
  });
});
