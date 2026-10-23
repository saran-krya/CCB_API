import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { hostname } from 'os';
import { SftpService } from './sftp.service';
import { ValidationService, AnomalySeverity, RowValidationError } from './validation.service';
import { MeterHierarchyResolverService } from './meter-hierarchy-resolver.service';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';
import { SftpIngestionStatus } from './entities/sftp-ingestion-status.enum';
import { TriggerSource } from './entities/trigger-source.enum';
import { MeterReading, ReadingAnomalyCode, ReadingApprovalStatus, ReadingValidationStatus } from './entities/meter-reading.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Property } from '../property/entities/property.entity';
import { Community } from '../community/entities/community.entity';
import { parseReadingDateFromFilename } from './filename.util';

function toAnomalyCode(error: RowValidationError): ReadingAnomalyCode {
  switch (error.field) {
    case 'meter_id':
      return ReadingAnomalyCode.MISSING_METER_ID;
    case 'reading_date':
      return ReadingAnomalyCode.MISSING_READING_DATE;
    case 'unit':
      return ReadingAnomalyCode.MISSING_UNIT;
    case 'reading_value':
      if (error.message === 'reading_value must be numeric') return ReadingAnomalyCode.NON_NUMERIC_READING_VALUE;
      if (error.message === 'Value cannot be negative') return ReadingAnomalyCode.NEGATIVE_READING_VALUE;
      return ReadingAnomalyCode.MISSING_READING_VALUE;
    default:
      return ReadingAnomalyCode.MISSING_READING_VALUE;
  }
}

export interface IngestSuccessResult {
  outcome: 'success';
  success: true;
  fileId: number;
  rowsInserted: number;
  duplicateReadingsSkipped: number;
}

export interface IngestDuplicateResult {
  outcome: 'duplicate';
  success: false;
  fileName: string;

  duplicateLogId: number;

  existingFileId: number;
  message: string;
}

export interface IngestSkippedResult {
  outcome: 'skipped';
  success: true;
  fileName: string;

  existingFileId: number;
  message: string;
}

export interface IngestRejectedTestFileResult {
  outcome: 'rejected_test_file';
  success: false;
  fileName: string;
  message: string;
}

export interface IngestValidationFailureResult {
  outcome: 'validation_failure';
  success: false;
  fileName: string;

  fileId: number;
  fileErrors: string[];
  rowErrors: { row: number; field: string; message: string }[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

export type IngestResult = IngestSuccessResult | IngestDuplicateResult | IngestValidationFailureResult | IngestSkippedResult | IngestRejectedTestFileResult;

// Guards against the EXACT incident this constant exists to document: a filename ending "_TEST" (or
// "-TEST", case-insensitive) in the extension-bearing part of the name reaching real ingestion. Two
// separate incidents (2026-10-15, 2026-10-16) each put a file like "DTU_DTU-AZG-001_20260928_TEST.csv"
// into the real incoming directory and had it ingested as if it were genuine field data — 95
// fabricated meter_readings rows resulted, soft-deleted after investigation. This check runs FIRST,
// before any download/parse/write, so a test-named file is rejected loudly and immediately rather
// than silently processed or quietly skipped. Deliberately unconditional (not gated behind an
// environment flag) — this project has no existing NODE_ENV/environment-detection convention to
// branch on, and a filename ending in "_TEST" should never be treated as real production data in
// ANY environment this code runs in; inventing an environment flag just for this check would be a
// bigger, riskier change than the guard itself and could be left misconfigured. If a genuine need
// arises to ingest a deliberately-named test file in a non-production environment, this check
// should be revisited then, with that real environment distinction in hand — not guessed at now.
const TEST_FILENAME_PATTERN = /[_-]TEST\.[A-Za-z0-9]+$/i;

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly sftp: SftpService,
    private readonly validation: ValidationService,
    private readonly hierarchyResolver: MeterHierarchyResolverService,
    private readonly dataSource: DataSource,
    @InjectRepository(SftpIngestionLog) private readonly ingestionLogs: Repository<SftpIngestionLog>,
  ) {}

  async ingestFile(
    fileName: string,
    options: { triggerSource?: TriggerSource; jobId?: string; isRetrigger?: boolean } = {},
  ): Promise<IngestResult> {
    // Runs before ANY download/parse/write — see TEST_FILENAME_PATTERN's own doc comment for why.
    if (TEST_FILENAME_PATTERN.test(fileName)) {
      const message = `Rejected "${fileName}" — filenames ending in "_TEST" (or "-TEST") are never treated as real reading data, regardless of trigger source or environment.`;
      this.logger.error(message);
      return { outcome: 'rejected_test_file', success: false, fileName, message };
    }

    const triggerSource = options.triggerSource ?? TriggerSource.MANUAL;

    const processingStartedAt = new Date();

    const readingDate = parseReadingDateFromFilename(fileName);

    const { localPath } = await this.sftp.downloadFile(fileName);
    const { rows } = await this.sftp.parseFile(localPath);

    const fileChecksumSha256 = await this.hashFile(localPath);

    const existing = await this.ingestionLogs.findOne({ where: { fileChecksumSha256 } });

    if (existing?.fileStatus === SftpIngestionStatus.PROCESSED && !options.isRetrigger) {
      this.logger.log(`Skipping "${fileName}" — already successfully processed as log #${existing.id} (hash ${fileChecksumSha256}); no new record created`);
      return {
        outcome: 'skipped',
        success: true,
        fileName,
        existingFileId: existing.id,
        message: 'File already processed successfully — skipped, no new record created.',
      };
    }

    if (existing) {
      const processingCompletedAt = new Date();
  
      const duplicateLog = await this.ingestionLogs.save(
        this.ingestionLogs.create({
          fileName,
          originalFileName: fileName,
          filePath: localPath,
          fileSizeBytes: (await stat(localPath)).size,
          fileChecksumSha256: null,
          existingFileId: existing.id,
          fileStatus: SftpIngestionStatus.DUPLICATE,
          readingDate,
          receivedMeterCount: 0,
          validReadingCount: 0,
          anomalyCount: 0,
          processingStartedAt,
          processingCompletedAt,
          processingDurationMs: processingCompletedAt.getTime() - processingStartedAt.getTime(),
          triggerSource,
          jobId: options.jobId ?? null,
          processingNode: hostname(),
        }),
      );

      this.logger.warn(`Duplicate file detected: "${fileName}" matches existing ingestion log #${existing.id} (hash ${fileChecksumSha256}) — recorded as log #${duplicateLog.id}`);
      return {
        outcome: 'duplicate',
        success: false,
        fileName,
        duplicateLogId: duplicateLog.id,
        existingFileId: existing.id,
        message: 'File has already been processed.',
      };
    }

    const fileResult = await this.validation.validateFile(localPath, rows);
    const rowResult = await this.validation.validateRows(rows);

   
    if (!fileResult.valid) {
      this.logger.warn(`File-level validation failed for "${fileName}": ${fileResult.errors.join('; ')}`);
      const processingCompletedAt = new Date();

      const failedLog = await this.ingestionLogs.save(
        this.ingestionLogs.create({
          fileName,
          originalFileName: fileName,
          filePath: localPath,
          fileSizeBytes: (await stat(localPath)).size,
          fileChecksumSha256,
          fileStatus: SftpIngestionStatus.FAILED,
          readingDate,
          receivedMeterCount: rowResult.totalRows,
          validReadingCount: 0,
          anomalyCount: rowResult.invalidRows,
          criticalAnomalyCount: rowResult.severityCounts[AnomalySeverity.CRITICAL],
          highAnomalyCount: rowResult.severityCounts[AnomalySeverity.HIGH],
          mediumAnomalyCount: rowResult.severityCounts[AnomalySeverity.MEDIUM],
          lowAnomalyCount: rowResult.severityCounts[AnomalySeverity.LOW],
          errorMessage: fileResult.errors.join('; '),
          processingStartedAt,
          processingCompletedAt,
          processingDurationMs: processingCompletedAt.getTime() - processingStartedAt.getTime(),
          triggerSource,
          jobId: options.jobId ?? null,
          processingNode: hostname(),
        }),
      );

      return {
        outcome: 'validation_failure',
        success: false,
        fileName,
        fileId: failedLog.id,
        fileErrors: fileResult.errors,
        rowErrors: rowResult.errors,
        totalRows: rowResult.totalRows,
        validRows: rowResult.validRows,
        invalidRows: rowResult.invalidRows,
      };
    }

    const worstErrorByRow = this.validation.getWorstErrorPerRow(rowResult.errors);

    const processingNode = hostname();
    const { size: fileSizeBytes } = await stat(localPath);

    const distinctMeterIds = Array.from(new Set(rows.map((row) => row.meter_id?.trim()).filter((id): id is string => !!id)));
    const hierarchyByMeterId = await this.hierarchyResolver.resolveBatch(distinctMeterIds);

    const resolvedPropertyIds = new Set<number>();
    const resolvedCommunityIds = new Set<number>();
    let duplicateReadingCount = 0;

    const saved = await this.dataSource.transaction(async (manager) => {
      // Reading-level duplicate check (defense in depth alongside the DB unique constraint on
      // meter_readings(sub_meter_id, reading_date)): for every row that resolved to a real
      // subMeter, skip it if a reading already exists for that (subMeterId, readingDate) pair —
      // either from a prior file (different file, same meter+date) or earlier in this same batch.
      // Rows that did not resolve to a subMeter (hierarchy undefined) are untouched by this check
      // and insert exactly as before.
      const candidateSubMeterIds = new Set<number>();
      for (const row of rows) {
        const meterId = row.meter_id?.trim();
        const hierarchy = meterId ? hierarchyByMeterId.get(meterId) : undefined;
        if (hierarchy) candidateSubMeterIds.add(hierarchy.subMeterId);
      }

      const existingPairs = new Set<string>();
      if (candidateSubMeterIds.size > 0) {
        const existingReadings = await manager
          .getRepository(MeterReading)
          .createQueryBuilder('mr')
          .select('mr.sub_meter_id', 'subMeterId')
          .addSelect('mr.reading_date', 'readingDate')
          .where('mr.sub_meter_id IN (:...subMeterIds)', { subMeterIds: [...candidateSubMeterIds] })
          .getRawMany<{ subMeterId: number; readingDate: string }>();
        for (const r of existingReadings) {
          existingPairs.add(`${r.subMeterId}::${r.readingDate}`);
        }
      }

      const log = manager.create(SftpIngestionLog, {
        fileName,
        originalFileName: fileName,
        filePath: localPath,
        fileSizeBytes,
        fileChecksumSha256,
        fileStatus: SftpIngestionStatus.PROCESSED,
        readingDate,
        receivedMeterCount: rowResult.totalRows,
        validReadingCount: rowResult.validRows,
        anomalyCount: rowResult.invalidRows,
        criticalAnomalyCount: rowResult.severityCounts[AnomalySeverity.CRITICAL],
        highAnomalyCount: rowResult.severityCounts[AnomalySeverity.HIGH],
        mediumAnomalyCount: rowResult.severityCounts[AnomalySeverity.MEDIUM],
        lowAnomalyCount: rowResult.severityCounts[AnomalySeverity.LOW],
        duplicateReadingCount: 0,
        processingStartedAt,
        triggerSource,
        jobId: options.jobId ?? null,
        processingNode,
      });
      const savedLog = await manager.save(SftpIngestionLog, log);

      if (rows.length > 0) {
        const readingEntities: MeterReading[] = [];

        rows.forEach((row, index) => {
          const meterId = row.meter_id?.trim() ?? '';
          const hierarchy = meterId ? hierarchyByMeterId.get(meterId) : undefined;

          const resolvedReadingDate = row.reading_date?.trim() || processingStartedAt.toISOString().slice(0, 10);

          if (hierarchy) {
            const pairKey = `${hierarchy.subMeterId}::${resolvedReadingDate}`;
            if (existingPairs.has(pairKey)) {
              // Already have a reading for this sub-meter + date (from this file or an earlier
              // one) — skip without overwriting the existing value and without inserting a
              // second row. Do not pick a "winner"; this is a reject, not a merge.
              duplicateReadingCount += 1;
              return;
            }
            // Track within this batch too, so two rows in the same file for the same
            // sub-meter + date don't both insert.
            existingPairs.add(pairKey);

            resolvedPropertyIds.add(hierarchy.propertyId);
            resolvedCommunityIds.add(hierarchy.communityId);
          }

          const worstError = worstErrorByRow.get(index + 1);
          const validationStatus = worstError ? ReadingValidationStatus.ANOMALY : ReadingValidationStatus.CLEAN;

          const isAutoApproved = validationStatus === ReadingValidationStatus.CLEAN;

          readingEntities.push(
            manager.create(MeterReading, {
              meterId,
              readingDate: resolvedReadingDate,
              readingValue: row.reading_value?.trim() || null,
              unit: row.unit?.trim() || null,
              validationStatus,
              anomalyCode: worstError ? toAnomalyCode(worstError) : null,
              anomalySeverity: worstError?.severity ?? null,
              anomalyMessage: worstError?.message ?? null,
              approvalStatus: isAutoApproved ? ReadingApprovalStatus.APPROVED : ReadingApprovalStatus.PENDING,
              approvedAt: isAutoApproved ? processingStartedAt : null,
              approvedBy: isAutoApproved ? 'SYSTEM' : null,
              sourceFile: savedLog,
              subMeter: hierarchy ? ({ id: hierarchy.subMeterId } as SubMeter) : null,
              propertyUnit: hierarchy?.unitId ? ({ id: hierarchy.unitId } as Unit) : null,
              property: hierarchy ? ({ id: hierarchy.propertyId } as Property) : null,
              community: hierarchy ? ({ id: hierarchy.communityId } as Community) : null,
            }),
          );
        });

        if (readingEntities.length > 0) {
          try {
            await manager.save(MeterReading, readingEntities);
          } catch (err) {
            if (!this.isDuplicateKeyError(err)) throw err;

            // The pre-query above is a best-effort check, not a lock — a concurrent ingestion run
            // for the same sub-meter + reading date can still race past it and reach this bulk
            // insert first. When that happens, the DB's own UNIQUE(sub_meter_id, reading_date)
            // constraint is the real backstop and rejects the whole bulk statement. Falling back to
            // one-row-at-a-time here (only on this rare path, never on the common path) lets every
            // genuinely-new row in the batch still insert — only the row(s) that actually lost the
            // race are skipped, exactly like a pre-detected duplicate.
            this.logger.warn(
              `Bulk insert hit a duplicate-key conflict for "${fileName}" (concurrent ingestion race) — retrying ${readingEntities.length} row(s) individually so non-conflicting rows still insert`,
            );
            for (const entity of readingEntities) {
              try {
                await manager.save(MeterReading, entity);
              } catch (rowErr) {
                if (!this.isDuplicateKeyError(rowErr)) throw rowErr;
                duplicateReadingCount += 1;
              }
            }
          }
        }

        if (duplicateReadingCount > 0) {
          await manager.update(SftpIngestionLog, savedLog.id, { duplicateReadingCount });
        }
      }

      return savedLog;
    });

    const processingCompletedAt = new Date();
    const processingDurationMs = processingCompletedAt.getTime() - processingStartedAt.getTime();

    const resolvedPropertyId = resolvedPropertyIds.size === 1 ? [...resolvedPropertyIds][0] : null;
    const resolvedCommunityId = resolvedCommunityIds.size === 1 ? [...resolvedCommunityIds][0] : null;

    await this.ingestionLogs.update(saved.id, {
      processingCompletedAt,
      processingDurationMs,
      ...(resolvedPropertyId ? { property: { id: resolvedPropertyId } as Property } : {}),
      ...(resolvedCommunityId ? { community: { id: resolvedCommunityId } as Community } : {}),
    });

    const rowsInserted = rows.length - duplicateReadingCount;

    this.logger.log(
      `Ingested "${fileName}" — log #${saved.id}, ${rowsInserted} reading(s) inserted ` +
      `(${rowResult.validRows} clean, ${rowResult.invalidRows} anomaly)` +
      `${duplicateReadingCount > 0 ? `, ${duplicateReadingCount} duplicate-reading row(s) skipped` : ''}, ${processingDurationMs}ms`,
    );

    return {
      outcome: 'success',
      success: true,
      fileId: saved.id,
      rowsInserted,
      duplicateReadingsSkipped: duplicateReadingCount,
    };
  }

  
  // Same idiom as MeterService's toCommitFailure/toDuplicateKeyException — MySQL's ER_DUP_ENTRY,
  // recognized either by TypeORM's wrapped driver error code or by its message text.
  private isDuplicateKeyError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /duplicate entry/i.test(message) || (err as { code?: string })?.code === 'ER_DUP_ENTRY';
  }

  private hashFile(localPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      createReadStream(localPath)
        .on('error', reject)
        .on('data', (chunk) => hash.update(chunk))
        .on('end', () => resolve(hash.digest('hex')));
    });
  }
}
