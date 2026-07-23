import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { hostname } from 'os';
import { SftpService } from './sftp.service';
import { ValidationService, AnomalySeverity } from './validation.service';
import { MeterHierarchyResolverService } from './meter-hierarchy-resolver.service';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';
import { SftpIngestionStatus } from './entities/sftp-ingestion-status.enum';
import { TriggerSource } from './entities/trigger-source.enum';
import { MeterReading } from './entities/meter-reading.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Property } from '../property/entities/property.entity';
import { Community } from '../community/entities/community.entity';

export interface IngestSuccessResult {
  outcome: 'success';
  success: true;
  fileId: number;
  rowsInserted: number;
}

export interface IngestDuplicateResult {
  outcome: 'duplicate';
  success: false;
  fileName: string;

  duplicateLogId: number;

  existingFileId: number;
  message: string;
}

// A checksum match against an already-PROCESSED row, on a routine (non-
// retrigger) call — no new sftp_ingestion_logs row is written at all, unlike
// IngestDuplicateResult (which still records an audit row for every other
// kind of checksum match, e.g. re-encountering a previously FAILED file).
export interface IngestSkippedResult {
  outcome: 'skipped';
  success: true;
  fileName: string;

  existingFileId: number;
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

export type IngestResult = IngestSuccessResult | IngestDuplicateResult | IngestValidationFailureResult | IngestSkippedResult;

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
    const triggerSource = options.triggerSource ?? TriggerSource.MANUAL;

    const processingStartedAt = new Date();

    const { localPath } = await this.sftp.downloadFile(fileName);
    const { rows } = await this.sftp.parseCsv(localPath);

    const fileChecksumSha256 = await this.hashFile(localPath);

    const existing = await this.ingestionLogs.findOne({ where: { fileChecksumSha256 } });

    // A file whose exact bytes already succeeded gets skipped outright on a
    // routine run — no new row at all, not even a DUPLICATE audit entry —
    // so the Files List doesn't accumulate a fresh record every time an
    // already-processed file happens to still be sitting in /incoming.
    // isRetrigger is the explicit, user-initiated escape hatch: it forces
    // the file all the way back through validation regardless of history.
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

    // Only rows that passed validateRows() become MeterReading records —
    // a row flagged invalid (missing meter_id, non-numeric/negative
    // reading_value, etc.) is counted in anomalyCount but never persisted.
    const invalidRowIndexes = new Set(rowResult.errors.map((e) => e.row - 1));
    const validRows = rows.filter((_, index) => !invalidRowIndexes.has(index));

    const processingNode = hostname();
    const { size: fileSizeBytes } = await stat(localPath);

    // Meter hierarchy resolution (meter_id -> SubMeter -> Unit -> Property ->
    // Community), batched once per file rather than once per row. A
    // meter_id with no matching SubMeter is simply absent from the map —
    // that reading still gets saved below, just without the resolved
    // hierarchy; existing validation/anomaly handling above is untouched.
    const distinctMeterIds = Array.from(new Set(validRows.map((row) => row.meter_id.trim())));
    const hierarchyByMeterId = await this.hierarchyResolver.resolveBatch(distinctMeterIds);

    const resolvedPropertyIds = new Set<number>();
    const resolvedCommunityIds = new Set<number>();

    const saved = await this.dataSource.transaction(async (manager) => {
      const log = manager.create(SftpIngestionLog, {
        fileName,
        originalFileName: fileName,
        filePath: localPath,
        fileSizeBytes,
        fileChecksumSha256,
        fileStatus: SftpIngestionStatus.PROCESSED,
        receivedMeterCount: rowResult.totalRows,
        validReadingCount: rowResult.validRows,
        anomalyCount: rowResult.invalidRows,
        criticalAnomalyCount: rowResult.severityCounts[AnomalySeverity.CRITICAL],
        highAnomalyCount: rowResult.severityCounts[AnomalySeverity.HIGH],
        mediumAnomalyCount: rowResult.severityCounts[AnomalySeverity.MEDIUM],
        lowAnomalyCount: rowResult.severityCounts[AnomalySeverity.LOW],
        processingStartedAt,
        triggerSource,
        jobId: options.jobId ?? null,
        processingNode,
      });
      const savedLog = await manager.save(SftpIngestionLog, log);

      if (validRows.length > 0) {
        const readingEntities = validRows.map((row) => {
          const meterId = row.meter_id.trim();
          const hierarchy = hierarchyByMeterId.get(meterId);
          if (hierarchy) {
            resolvedPropertyIds.add(hierarchy.propertyId);
            resolvedCommunityIds.add(hierarchy.communityId);
          }

          return manager.create(MeterReading, {
            meterId,
            readingDate: row.reading_date.trim(),
            readingValue: row.reading_value.trim(),
            unit: row.unit.trim(),
            sourceFile: savedLog,
            subMeter: hierarchy ? ({ id: hierarchy.subMeterId } as SubMeter) : null,
            propertyUnit: hierarchy?.unitId ? ({ id: hierarchy.unitId } as Unit) : null,
            property: hierarchy ? ({ id: hierarchy.propertyId } as Property) : null,
            community: hierarchy ? ({ id: hierarchy.communityId } as Community) : null,
          });
        });
        await manager.save(MeterReading, readingEntities);
      }

      return savedLog;
    });

    const processingCompletedAt = new Date();
    const processingDurationMs = processingCompletedAt.getTime() - processingStartedAt.getTime();

    // One file can only ever belong to a single Property/Community. If
    // every resolved reading in this file agrees, stamp it onto the log row
    // (this is what lets Files List/dashboards filter by property/community
    // without a per-row join). If readings resolved to more than one
    // Property or Community — or none resolved at all — leave both null
    // rather than guess; a single file cannot represent multiple properties.
    const resolvedPropertyId = resolvedPropertyIds.size === 1 ? [...resolvedPropertyIds][0] : null;
    const resolvedCommunityId = resolvedCommunityIds.size === 1 ? [...resolvedCommunityIds][0] : null;

    await this.ingestionLogs.update(saved.id, {
      processingCompletedAt,
      processingDurationMs,
      ...(resolvedPropertyId ? { property: { id: resolvedPropertyId } as Property } : {}),
      ...(resolvedCommunityId ? { community: { id: resolvedCommunityId } as Community } : {}),
    });

    this.logger.log(
      `Ingested "${fileName}" — log #${saved.id}, ${validRows.length} reading(s) inserted, ${processingDurationMs}ms`,
    );

    return { outcome: 'success', success: true, fileId: saved.id, rowsInserted: validRows.length };
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
