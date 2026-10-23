import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';
import { SftpIngestionStatus } from './entities/sftp-ingestion-status.enum';
import { SftpEstateSummary } from './entities/sftp-estate-summary.entity';
import { EstateIngestionStatus } from './entities/estate-ingestion-status.enum';
import { MeterReading } from './entities/meter-reading.entity';
import { MasterMeter } from '../meter/entities/master-meter.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';

const DUBAI_UTC_OFFSET_HOURS = 4;

interface LogAggregate {
  filesReceived: number;
  filesMissing: number;
  filesFailed: number;
  filesDuplicate: number;
  metersReceived: number;
  validReadings: number;
  anomalyCount: number;
  criticalAnomalyCount: number;
  highAnomalyCount: number;
  mediumAnomalyCount: number;
  lowAnomalyCount: number;
  ingestionStartedAt: Date | null;
  ingestionCompletedAt: Date | null;
  summaryDate: string | null;
}

@Injectable()
export class EstateSummaryService {
  private readonly logger = new Logger(EstateSummaryService.name);

  constructor(
    @InjectRepository(SftpIngestionLog) private readonly ingestionLogs: Repository<SftpIngestionLog>,
    @InjectRepository(SftpEstateSummary) private readonly summaries: Repository<SftpEstateSummary>,
    @InjectRepository(MasterMeter) private readonly masterMeters: Repository<MasterMeter>,
    @InjectRepository(SubMeter) private readonly subMeters: Repository<SubMeter>,
    @InjectRepository(MeterReading) private readonly meterReadings: Repository<MeterReading>,
  ) {}

  // Selects strictly by UPLOAD/PROCESSING date (created_at), never reading_date — a confirmed
  // incident showed the OLD reading_date-first selection (falling back to created_at only when
  // reading_date was null) incorrectly attributed a file's row to the day its READINGS were for,
  // not the day it was actually processed (e.g. a file uploaded 2026-10-13 containing readings
  // dated 2026-09-28 used to count toward Sep 28's summary, not Oct 13's). This dashboard now
  // always means "what was uploaded/processed on day X," matching the Files tab's own SFTP Date
  // filter exactly. See sftp-cron.service.ts's own comment on why this method is ONLY ever called
  // with today's real run date now, never a reading-date — calling it with a date nothing was
  // actually uploaded on would correctly persist an all-zero summary, silently overwriting whatever
  // real summary already existed for that day.
  async generateSummaryForDate(date: string): Promise<SftpEstateSummary> {
    const rows = await this.ingestionLogs
      .createQueryBuilder('log')
      .where('DATE(log.created_at) = :date', { date })
      .getMany();

    if (rows.length === 0) {
      return this.persistSummary({
        filesReceived: 0,
        filesMissing: 0,
        filesFailed: 0,
        filesDuplicate: 0,
        metersReceived: 0,
        validReadings: 0,
        anomalyCount: 0,
        criticalAnomalyCount: 0,
        highAnomalyCount: 0,
        mediumAnomalyCount: 0,
        lowAnomalyCount: 0,
        ingestionStartedAt: null,
        ingestionCompletedAt: null,
        summaryDate: date,
      });
    }

    return this.persistSummary(this.aggregateRows(rows, date));
  }

  async recalculateSummary(date: string): Promise<SftpEstateSummary> {
    return this.generateSummaryForDate(date);
  }

  async recordFailedPoll(jobId: string): Promise<SftpEstateSummary> {
    const summaryDate = this.toDateString(new Date());
    const existing = await this.summaries.findOne({ where: { summaryDate } });

    if (existing && existing.ingestionStatus !== EstateIngestionStatus.FAILED) {
      this.logger.warn(`Failed poll (job ${jobId}) ignored — a real summary already exists for ${summaryDate}`);
      return existing;
    }

    const filesExpected = await this.countRegisteredDtus();
    const metersExpected = await this.sumExpectedMeters();
    const summary = existing ?? this.summaries.create({ summaryDate });

    Object.assign(summary, {
      ingestionStatus: EstateIngestionStatus.FAILED,
      ingestionStartedAt: null,
      ingestionCompletedAt: null,
      filesExpected,
      filesReceived: 0,
      filesMissing: 0,
      filesFailed: 0,
      filesDuplicate: 0,
      metersExpected,
      metersReceived: 0,
      distinctMetersReporting: 0,
      validReadings: 0,
      anomalyCount: 0,
      criticalAnomalyCount: 0,
      highAnomalyCount: 0,
      mediumAnomalyCount: 0,
      lowAnomalyCount: 0,
      activeMeters: 0,
      dataQualityPct: '0.00',
    });

    const saved = await this.summaries.save(summary);
    this.logger.log(`Estate summary for ${summaryDate} recorded as FAILED poll (job ${jobId}, no log rows)`);
    return saved;
  }

  private aggregateRows(rows: SftpIngestionLog[], summaryDate: string): LogAggregate {
    let filesReceived = 0;
    let filesMissing = 0;
    let filesFailed = 0;
    let filesDuplicate = 0;
    let metersReceived = 0;
    let validReadings = 0;
    let anomalyCount = 0;
    let criticalAnomalyCount = 0;
    let highAnomalyCount = 0;
    let mediumAnomalyCount = 0;
    let lowAnomalyCount = 0;
    let ingestionStartedAt: Date | null = null;
    let ingestionCompletedAt: Date | null = null;

    for (const row of rows) {
      switch (row.fileStatus) {
        case SftpIngestionStatus.PROCESSED:
          filesReceived += 1;
          break;
        case SftpIngestionStatus.MISSING:
          filesMissing += 1;
          break;
        case SftpIngestionStatus.FAILED:
          filesFailed += 1;
          break;
        case SftpIngestionStatus.DUPLICATE:
          filesDuplicate += 1;
          break;
        default:

          break;
      }

      metersReceived += row.receivedMeterCount;
      validReadings += row.validReadingCount;
      anomalyCount += row.anomalyCount;
      criticalAnomalyCount += row.criticalAnomalyCount;
      highAnomalyCount += row.highAnomalyCount;
      mediumAnomalyCount += row.mediumAnomalyCount;
      lowAnomalyCount += row.lowAnomalyCount;

      if (row.processingStartedAt && (!ingestionStartedAt || row.processingStartedAt < ingestionStartedAt)) {
        ingestionStartedAt = row.processingStartedAt;
      }
      if (row.processingCompletedAt && (!ingestionCompletedAt || row.processingCompletedAt > ingestionCompletedAt)) {
        ingestionCompletedAt = row.processingCompletedAt;
      }
    }

    return {
      filesReceived,
      filesMissing,
      filesFailed,
      filesDuplicate,
      metersReceived,
      validReadings,
      anomalyCount,
      criticalAnomalyCount,
      highAnomalyCount,
      mediumAnomalyCount,
      lowAnomalyCount,
      ingestionStartedAt,
      ingestionCompletedAt,
      summaryDate,
    };
  }

  private async persistSummary(aggregate: LogAggregate): Promise<SftpEstateSummary> {
    const summaryDate = aggregate.summaryDate!;
    const filesExpected = await this.countRegisteredDtus();
    const metersExpected = await this.sumExpectedMeters();
    const distinctMetersReporting = await this.countDistinctMetersReporting(summaryDate);

    const activeMeters = aggregate.validReadings + aggregate.anomalyCount;

    const dataQualityPct =
      metersExpected > 0 ? ((aggregate.validReadings / metersExpected) * 100).toFixed(2) : '0.00';

    const ingestionStatus =
      aggregate.filesMissing === 0 && aggregate.filesFailed === 0
        ? EstateIngestionStatus.COMPLETE
        : EstateIngestionStatus.PARTIAL;

    const existing = await this.summaries.findOne({ where: { summaryDate } });
    const summary = existing ?? this.summaries.create({ summaryDate });

    Object.assign(summary, {
      ingestionStatus,
      ingestionStartedAt: aggregate.ingestionStartedAt,
      ingestionCompletedAt: aggregate.ingestionCompletedAt,
      filesExpected,
      filesReceived: aggregate.filesReceived,
      filesMissing: aggregate.filesMissing,
      filesFailed: aggregate.filesFailed,
      filesDuplicate: aggregate.filesDuplicate,
      metersExpected,
      metersReceived: aggregate.metersReceived,
      distinctMetersReporting,
      validReadings: aggregate.validReadings,
      anomalyCount: aggregate.anomalyCount,
      criticalAnomalyCount: aggregate.criticalAnomalyCount,
      highAnomalyCount: aggregate.highAnomalyCount,
      mediumAnomalyCount: aggregate.mediumAnomalyCount,
      lowAnomalyCount: aggregate.lowAnomalyCount,
      activeMeters,
      dataQualityPct,
    });

    const saved = await this.summaries.save(summary);
    this.logger.log(
      `Estate summary for ${summaryDate}: ${ingestionStatus}, ${aggregate.filesReceived} received / ${filesExpected} expected, quality ${dataQualityPct}%`,
    );
    return saved;
  }

  // Real "distinct meters reporting" count for one date — COUNT(DISTINCT sub_meter_id) from
  // meter_readings, scoped to readings whose sub_meter_id actually resolved to a real SubMeter
  // during ingestion (see ingestion.service.ts: subMeter is set only when the hierarchy resolver
  // found a match, null otherwise). This deliberately counts DISTINCT resolved meters, not raw CSV
  // rows (that's the pre-existing metersReceived field, left untouched) and not raw meter_id
  // strings (which could include values that never resolved to anything real). MeterReading's own
  // unique index on (sub_meter_id, reading_date) means at most one row per meter per day anyway, so
  // this is equivalent to a plain COUNT for a single date — the DISTINCT is what makes the query
  // correct in general (e.g. if ever queried across a range) without depending on that constraint.
  private async countDistinctMetersReporting(date: string): Promise<number> {
    const result = await this.meterReadings
      .createQueryBuilder('r')
      .select('COUNT(DISTINCT r.sub_meter_id)', 'count')
      .where('r.reading_date = :date', { date })
      .andWhere('r.sub_meter_id IS NOT NULL')
      .getRawOne<{ count: string }>();
    return Number(result?.count ?? 0);
  }

  private async countRegisteredDtus(): Promise<number> {
    return this.masterMeters.createQueryBuilder('m').where('m.dtu_id IS NOT NULL').getCount();
  }

  private async sumExpectedMeters(): Promise<number> {
    const registry = await this.masterMeters
      .createQueryBuilder('m')
      .select('m.property_id', 'propertyId')
      .where('m.dtu_id IS NOT NULL')
      .getRawMany<{ propertyId: number }>();

    if (registry.length === 0) return 0;

    const propertyIds = registry.map((r) => r.propertyId);
    const result = await this.subMeters
      .createQueryBuilder('s')
      .select('COUNT(*)', 'count')
      .where('s.property_id IN (:...propertyIds)', { propertyIds })
      .getRawOne<{ count: string }>();

    return Number(result?.count ?? 0);
  }

  private toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  async getSummaryForDate(date: string): Promise<SftpEstateSummary | null> {
    return this.summaries.findOne({ where: { summaryDate: date } });
  }

  async getMissingLogsForDate(date: string): Promise<SftpIngestionLog[]> {
    return this.ingestionLogs
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.property', 'property')
      .leftJoinAndSelect('log.community', 'community')
      .where('log.file_status = :status', { status: SftpIngestionStatus.MISSING })
      .andWhere('log.reading_date = :date', { date })
      .getMany();
  }

  // Scoped by READING date (falling back to created_at only when no reading_date could be parsed
  // from the filename) — the OPPOSITE of generateSummaryForDate/aggregateRows above, which scopes
  // files.failed strictly by UPLOAD/PROCESSING date. This is deliberate, not an oversight left over
  // from the same incident that fixed the summary-count path: this method answers "which failed
  // files represent THIS reading period," a genuinely different, also-real question from "what
  // failed during processing on THIS calendar day." The two can disagree for the same row (a file
  // uploaded today whose filename encodes a reading date from weeks ago) — confirmed, and the
  // frontend labels each section with its own scoping explicitly for exactly this reason. Never
  // change this method's scoping to match aggregateRows' without first confirming the "Failed Files"
  // detail table is meant to answer the same question the stat card above it does — today it is not.
  async getFailedLogsForDate(date: string): Promise<SftpIngestionLog[]> {
    return this.ingestionLogs
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.property', 'property')
      .leftJoinAndSelect('log.community', 'community')
      .where('log.file_status = :status', { status: SftpIngestionStatus.FAILED })
      .andWhere('(log.reading_date = :date OR (log.reading_date IS NULL AND DATE(log.created_at) = :date))', { date })
      .getMany();
  }

  async getSummariesBetween(fromDate: string, toDate: string): Promise<SftpEstateSummary[]> {
    return this.summaries.find({
      where: { summaryDate: Between(fromDate, toDate) },
      order: { summaryDate: 'ASC' },
    });
  }

  async getLatestSummary(): Promise<SftpEstateSummary | null> {
    return this.summaries.findOne({ where: {}, order: { summaryDate: 'DESC' } });
  }

  getNextScheduledPoll(now: Date = new Date()): string {
    const dubaiNow = new Date(now.getTime() + DUBAI_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    const nextDubai = new Date(
      Date.UTC(dubaiNow.getUTCFullYear(), dubaiNow.getUTCMonth(), dubaiNow.getUTCDate(), 0, 30, 0, 0),
    );
    if (nextDubai.getTime() <= dubaiNow.getTime()) {
      nextDubai.setUTCDate(nextDubai.getUTCDate() + 1);
    }
    const nextUtc = new Date(nextDubai.getTime() - DUBAI_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    return nextUtc.toISOString();
  }
}
