import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';
import { SftpIngestionStatus } from './entities/sftp-ingestion-status.enum';
import { SftpEstateSummary } from './entities/sftp-estate-summary.entity';
import { EstateIngestionStatus } from './entities/estate-ingestion-status.enum';
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
  ) {}


  async generateSummaryForDate(date: string): Promise<SftpEstateSummary> {
    // reading_date (parsed from the file's own name — see filename.util.ts) is
    // the authoritative match. DATE(created_at) is a fallback for the rare
    // row where reading_date is still unknown (e.g. an unparseable filename),
    // NOT a second unconditional match path — a file with a real reading_date
    // must be counted under its own date only, even if it happened to be
    // ingested on a different calendar day (this was a real bug: a file for
    // 07-21 ingested on 07-23 was being double-counted into 07-23's summary
    // via this OR, inflating that day's numbers with a previous day's data).
    const rows = await this.ingestionLogs
      .createQueryBuilder('log')
      .where('log.reading_date = :date', { date })
      .orWhere('log.reading_date IS NULL AND DATE(log.created_at) = :date', { date })
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

  async getFailedLogsForDate(date: string): Promise<SftpIngestionLog[]> {
    // Same reading_date-first rule as generateSummaryForDate() above — a
    // failed file now carries its own real reading_date (see
    // ingestion.service.ts), so it must be listed under its own date, not
    // whatever day it happened to be ingested on.
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
