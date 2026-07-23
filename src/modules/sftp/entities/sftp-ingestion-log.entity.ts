import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Community } from '../../community/entities/community.entity';
import { Property } from '../../property/entities/property.entity';
import { SftpIngestionStatus } from './sftp-ingestion-status.enum';
import { TriggerSource } from './trigger-source.enum';
import { MeterReading } from './meter-reading.entity';


@Entity('sftp_ingestion_logs')
@Index('UQ_sftp_ingestion_logs_file_checksum', ['fileChecksumSha256'], { unique: true })
@Index('IDX_sftp_ingestion_logs_file_name', ['fileName'])
@Index('IDX_sftp_ingestion_logs_status', ['fileStatus'])
@Index('IDX_sftp_ingestion_logs_processing_completed_at', ['processingCompletedAt'])
@Index('IDX_sftp_ingestion_logs_job_id', ['jobId'])
@Index('IDX_sftp_ingestion_logs_dtu', ['dtu'])
export class SftpIngestionLog extends BaseEntity {

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName?: string | null;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255, nullable: true })
  originalFileName?: string | null;

  @Column({ name: 'file_path', type: 'varchar', length: 500, nullable: true })
  filePath?: string | null;

  @Column({ name: 'file_size_bytes', type: 'bigint', unsigned: true, nullable: true })
  fileSizeBytes?: number | null;

  @Column({ name: 'file_checksum_sha256', type: 'char', length: 64, nullable: true })
  fileChecksumSha256?: string | null;

  @Column({ name: 'existing_file_id', type: 'int', unsigned: true, nullable: true })
  existingFileId?: number | null;

  @Column({ name: 'file_status', type: 'enum', enum: SftpIngestionStatus, default: SftpIngestionStatus.DOWNLOADED })
  fileStatus!: SftpIngestionStatus;

    @Column({ name: 'received_meter_count', type: 'int', unsigned: true, default: 0 })
  receivedMeterCount!: number;


  @Column({ name: 'valid_reading_count', type: 'int', unsigned: true, default: 0 })
  validReadingCount!: number;

 
  @Column({ name: 'anomaly_count', type: 'int', unsigned: true, default: 0 })
  anomalyCount!: number;

 
  @Column({ name: 'critical_anomaly_count', type: 'int', unsigned: true, default: 0 })
  criticalAnomalyCount!: number;

  @Column({ name: 'high_anomaly_count', type: 'int', unsigned: true, default: 0 })
  highAnomalyCount!: number;

  @Column({ name: 'medium_anomaly_count', type: 'int', unsigned: true, default: 0 })
  mediumAnomalyCount!: number;

  @Column({ name: 'low_anomaly_count', type: 'int', unsigned: true, default: 0 })
  lowAnomalyCount!: number;

 
  @Column({ name: 'processing_started_at', type: 'datetime', nullable: true })
  processingStartedAt?: Date | null;

  @Column({ name: 'processing_completed_at', type: 'datetime', nullable: true })
  processingCompletedAt?: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;

  // ─── Cron / job tracking (Phase 6-7) ───────────────────────────────────────

  @Column({ name: 'trigger_source', type: 'enum', enum: TriggerSource, default: TriggerSource.CRON })
  triggerSource!: TriggerSource;

  @Column({ name: 'retry_count', type: 'int', unsigned: true, default: 0 })
  retryCount!: number;

  @Column({ name: 'last_retry_at', type: 'datetime', nullable: true })
  lastRetryAt?: Date | null;

  @Column({ name: 'job_id', type: 'char', length: 36, nullable: true })
  jobId?: string | null;

  @Column({ name: 'moved_to_folder', type: 'varchar', length: 255, nullable: true })
  movedToFolder?: string | null;

  @Column({ name: 'moved_at', type: 'datetime', nullable: true })
  movedAt?: Date | null;
  @Column({ name: 'processing_duration_ms', type: 'bigint', nullable: true })
  processingDurationMs?: number | null;

  @Column({ name: 'processing_node', type: 'varchar', length: 100, nullable: true })
  processingNode?: string | null;


  @Column({ name: 'dtu', type: 'varchar', length: 100, nullable: true })
  dtu?: string | null;

  @ManyToOne(() => Property, { nullable: true })
  @JoinColumn({ name: 'property_id' })
  property?: Property | null;

  @ManyToOne(() => Community, { nullable: true })
  @JoinColumn({ name: 'community_id' })
  community?: Community | null;

  @Column({ name: 'expected_meter_count', type: 'int', unsigned: true, nullable: true })
  expectedMeterCount?: number | null;

  @Column({ name: 'reading_date', type: 'date', nullable: true })
  readingDate?: string | null;

  @Column({ name: 'poll_timestamp', type: 'datetime', nullable: true })
  pollTimestamp?: Date | null;

  @OneToMany(() => MeterReading, (reading) => reading.sourceFile)
  meterReadings!: MeterReading[];
}
