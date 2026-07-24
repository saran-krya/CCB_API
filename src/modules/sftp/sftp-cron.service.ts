import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { SftpService } from './sftp.service';
import { IngestionService } from './ingestion.service';
import { FileMovementService } from './file-movement.service';
import { EstateSummaryService } from './estate-summary.service';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';
import { SftpIngestionStatus } from './entities/sftp-ingestion-status.enum';
import { TriggerSource } from './entities/trigger-source.enum';
import { MasterMeter } from '../meter/entities/master-meter.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';
import { DTU_FILENAME_PATTERN as FILENAME_PATTERN } from './filename.util';

const CONNECTIVITY_RETRY_DELAYS_MS = [1000, 2000, 4000];


@Injectable()
export class SftpCronService {
  private readonly logger = new Logger(SftpCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sftp: SftpService,
    private readonly ingestion: IngestionService,
    private readonly fileMovement: FileMovementService,
    private readonly estateSummary: EstateSummaryService,
    @InjectRepository(SftpIngestionLog) private readonly ingestionLogs: Repository<SftpIngestionLog>,
    @InjectRepository(MasterMeter) private readonly masterMeters: Repository<MasterMeter>,
    @InjectRepository(SubMeter) private readonly subMeters: Repository<SubMeter>,
  ) { }


  @Cron('30 0 * * *', { timeZone: 'Asia/Dubai' })
  async handleNightlyRun(): Promise<void> {
    await this.runOnce(TriggerSource.CRON);
  }


  async runOnce(triggerSource: TriggerSource): Promise<{ jobId: string; processed: number; failed: number; skipped: number }> {
    const cronEnabled =
      this.config.get<string>('SFTP_CRON_ENABLED') === 'true';

    if (triggerSource === TriggerSource.CRON && !cronEnabled) {
      this.logger.log('Skipping SFTP cron run — SFTP_CRON_ENABLED=false');
      return {
        jobId: '',
        processed: 0,
        failed: 0,
        skipped: 0,
      };
    }

    const jobId = randomUUID();
    const startedAt = Date.now();
   
    const runDate = new Date().toISOString().slice(0, 10);
    this.logger.log(`[${jobId}] Cron Started (trigger=${triggerSource})`);

    let files: Awaited<ReturnType<SftpService['listFiles']>>;
    try {
      files = await this.connectWithRetry(jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`[${jobId}] Cron failure — could not connect after ${CONNECTIVITY_RETRY_DELAYS_MS.length} retries: ${message}`);
  
      await this.estateSummary.recordFailedPoll(jobId);
      return { jobId, processed: 0, failed: 0, skipped: 0 };
    }

    await this.checkMissingDtus(jobId, files, triggerSource, runDate);

    let processed = 0;
    let failed = 0;
    let skipped = 0;
    for (const file of files) {
     
      if (file.type !== '-' || !file.name.toLowerCase().endsWith('.csv')) continue;
      const outcome = await this.processOneFile(file.name, jobId, triggerSource);
      if (outcome === 'processed') processed += 1;
      else if (outcome === 'skipped') skipped += 1;
      else failed += 1;
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(`[${jobId}] Cron Finished — ${processed} processed, ${failed} failed, ${skipped} skipped, ${durationMs}ms`);

   
    await this.estateSummary.generateSummaryForDate(runDate);

    return { jobId, processed, failed, skipped };
  }

 
  private async connectWithRetry(jobId: string): Promise<Awaited<ReturnType<SftpService['listFiles']>>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= CONNECTIVITY_RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await this.sftp.listFiles();
      } catch (err) {
        lastError = err;
        if (attempt < CONNECTIVITY_RETRY_DELAYS_MS.length) {
          const delay = CONNECTIVITY_RETRY_DELAYS_MS[attempt];
          this.logger.warn(`[${jobId}] SFTP connection attempt ${attempt + 1} failed, retrying in ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  
  private async processOneFile(fileName: string, jobId: string, triggerSource: TriggerSource): Promise<'processed' | 'failed' | 'skipped'> {
    const fileStartedAt = Date.now();
    this.logger.log(`[${jobId}] File Started — ${fileName}`);

    try {
      const result = await this.ingestion.ingestFile(fileName, { triggerSource, jobId });
      const durationMs = Date.now() - fileStartedAt;

      if (result.outcome === 'skipped') {
        this.logger.log(`[${jobId}] File Skipped — ${fileName} (already processed as log #${result.existingFileId}), ${durationMs}ms`);
        
        return 'skipped';
      }

      if (result.outcome === 'success') {
        this.logger.log(`[${jobId}] File Completed — ${fileName} (log #${result.fileId}, ${result.rowsInserted} row(s), ${durationMs}ms)`);
        const move = await this.fileMovement.moveProcessed(fileName, result.fileId);
        this.logger.log(move.success ? `[${jobId}] Move Success — ${fileName} -> ${move.movedToFolder}` : `[${jobId}] Move Failed — ${fileName}: ${move.error}`);
        return 'processed';
      }

      if (result.outcome === 'duplicate') {
        this.logger.warn(`[${jobId}] Duplicate — ${fileName} (matches existing log #${result.existingFileId}, recorded as log #${result.duplicateLogId})`);
       
        const move = await this.fileMovement.moveDuplicate(fileName, result.duplicateLogId);
        this.logger.log(move.success ? `[${jobId}] Move Success — ${fileName} -> ${move.movedToFolder}` : `[${jobId}] Move Failed — ${fileName}: ${move.error}`);
        return 'failed';
      }

      this.logger.error(`[${jobId}] File Failed — ${fileName}: ${result.fileErrors.join('; ') || 'row validation failed'}`);
      const move = await this.fileMovement.moveFailed(fileName, result.fileId);
      this.logger.log(move.success ? `[${jobId}] Move Success — ${fileName} -> ${move.movedToFolder}` : `[${jobId}] Move Failed — ${fileName}: ${move.error}`);
      return 'failed';
    } catch (err) {
      
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`[${jobId}] File Failed — ${fileName}: ${message}`);
      return 'failed';
    }
  }


  private async checkMissingDtus(
    jobId: string,
    files: Awaited<ReturnType<SftpService['listFiles']>>,
    triggerSource: TriggerSource,
    readingDate: string,
  ): Promise<void> {
    const receivedDtus = new Set(
      files.map((f) => f.name.match(FILENAME_PATTERN)?.[1]).filter((dtu): dtu is string => !!dtu),
    );

    const registry = await this.masterMeters
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.property', 'property')
      .innerJoinAndSelect('property.community', 'community')
      .where('m.dtu_id IS NOT NULL')
      .getMany();

    const now = new Date();

    const alreadyMissingToday = new Set(
      (
        await this.ingestionLogs.find({
          where: { fileStatus: SftpIngestionStatus.MISSING, readingDate },
          select: ['dtu'],
        })
      ).map((log) => log.dtu),
    );

    const missing = registry.filter(
      (meter) => !receivedDtus.has(meter.dtuId!) && !alreadyMissingToday.has(meter.dtuId!),
    );
    if (missing.length === 0) return;

    for (const meter of missing) {
      const expectedMeterCount = await this.subMeters
        .createQueryBuilder('s')
        .where('s.property_id = :propertyId', { propertyId: meter.property.id })
        .getCount();

      await this.ingestionLogs.save(
        this.ingestionLogs.create({
          fileStatus: SftpIngestionStatus.MISSING,
          triggerSource,
          jobId,
          dtu: meter.dtuId,
          property: meter.property,
          community: meter.property.community,
          expectedMeterCount,
          readingDate,
          pollTimestamp: now,
        }),
      );
      this.logger.warn(`[${jobId}] Missing — DTU ${meter.dtuId} (property #${meter.property.id}) sent no file this run`);
    }
  }
}
