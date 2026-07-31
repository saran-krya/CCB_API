import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EstateIngestionStatus } from './estate-ingestion-status.enum';

@Entity('sftp_estate_summary')
@Index('UQ_sftp_estate_summary_date', ['summaryDate'], { unique: true })
@Index('IDX_sftp_estate_summary_status', ['ingestionStatus'])
export class SftpEstateSummary extends BaseEntity {
  @Column({ name: 'summary_date', type: 'date' })
  summaryDate!: string;

  @Column({ name: 'ingestion_status', type: 'enum', enum: EstateIngestionStatus, default: EstateIngestionStatus.FAILED })
  ingestionStatus!: EstateIngestionStatus;

  @Column({ name: 'ingestion_started_at', type: 'datetime', nullable: true })
  ingestionStartedAt?: Date | null;

  @Column({ name: 'ingestion_completed_at', type: 'datetime', nullable: true })
  ingestionCompletedAt?: Date | null;

  @Column({ name: 'files_expected', type: 'int', unsigned: true, default: 0 })
  filesExpected!: number;

  @Column({ name: 'files_received', type: 'int', unsigned: true, default: 0 })
  filesReceived!: number;

  @Column({ name: 'files_missing', type: 'int', unsigned: true, default: 0 })
  filesMissing!: number;

  @Column({ name: 'files_failed', type: 'int', unsigned: true, default: 0 })
  filesFailed!: number;

  @Column({ name: 'files_duplicate', type: 'int', unsigned: true, default: 0 })
  filesDuplicate!: number;

  @Column({ name: 'meters_expected', type: 'int', unsigned: true, default: 0 })
  metersExpected!: number;

  @Column({ name: 'meters_received', type: 'int', unsigned: true, default: 0 })
  metersReceived!: number;

  @Column({ name: 'valid_readings', type: 'int', unsigned: true, default: 0 })
  validReadings!: number;

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

  @Column({ name: 'active_meters', type: 'int', unsigned: true, default: 0 })
  activeMeters!: number;

  @Column({ name: 'data_quality_pct', type: 'decimal', precision: 5, scale: 2, default: 0 })
  dataQualityPct!: string;
}
