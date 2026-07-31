import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { SftpIngestionLog } from './sftp-ingestion-log.entity';
import { SubMeter } from '../../meter/entities/sub-meter.entity';
import { Unit } from '../../unit/entities/unit.entity';
import { Property } from '../../property/entities/property.entity';
import { Community } from '../../community/entities/community.entity';
import { AnomalySeverity } from '../validation.service';

export enum ReadingAnomalyCode {
  MISSING_METER_ID = 'VAL-001',
  MISSING_READING_VALUE = 'VAL-002',
  NON_NUMERIC_READING_VALUE = 'VAL-003',
  NEGATIVE_READING_VALUE = 'VAL-004',
  MISSING_READING_DATE = 'VAL-005',
  MISSING_UNIT = 'VAL-006',
}

export enum ReadingValidationStatus {
  CLEAN = 'clean',
  ANOMALY = 'anomaly',
  MISSING = 'missing',
}

export enum ReadingApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
}

@Entity('meter_readings')
@Index('IDX_meter_readings_meter_id', ['meterId'])
@Index('IDX_meter_readings_reading_date', ['readingDate'])
@Index('IDX_meter_readings_source_file_id', ['sourceFile'])
@Index('IDX_meter_readings_validation_status', ['validationStatus'])
export class MeterReading extends BaseEntity {
  @Column({ name: 'meter_id', type: 'varchar', length: 100 })
  meterId!: string;

  @Column({ name: 'reading_date', type: 'date' })
  readingDate!: string;

  @Column({ name: 'reading_value', type: 'decimal', precision: 14, scale: 4, nullable: true })
  readingValue?: string | null;

  @Column({ name: 'unit', type: 'varchar', length: 20, nullable: true })
  unit?: string | null;

  @Column({ name: 'validation_status', type: 'enum', enum: ReadingValidationStatus, default: ReadingValidationStatus.CLEAN })
  validationStatus!: ReadingValidationStatus;

  @Column({ name: 'anomaly_code', type: 'enum', enum: ReadingAnomalyCode, nullable: true })
  anomalyCode?: ReadingAnomalyCode | null;

  @Column({ name: 'anomaly_severity', type: 'enum', enum: AnomalySeverity, nullable: true })
  anomalySeverity?: AnomalySeverity | null;

  @Column({ name: 'anomaly_message', type: 'varchar', length: 255, nullable: true })
  anomalyMessage?: string | null;

  @Column({ name: 'approval_status', type: 'enum', enum: ReadingApprovalStatus, default: ReadingApprovalStatus.PENDING })
  approvalStatus!: ReadingApprovalStatus;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt?: Date | null;

  @Column({ name: 'approved_by', type: 'varchar', length: 100, nullable: true })
  approvedBy?: string | null;

  @ManyToOne(() => SftpIngestionLog, (log) => log.meterReadings, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_file_id' })
  sourceFile?: SftpIngestionLog | null;

  @ManyToOne(() => SubMeter, { nullable: true })
  @JoinColumn({ name: 'sub_meter_id' })
  subMeter?: SubMeter | null;

  @ManyToOne(() => Unit, { nullable: true })
  @JoinColumn({ name: 'unit_id' })
  propertyUnit?: Unit | null;

  @ManyToOne(() => Property, { nullable: true })
  @JoinColumn({ name: 'property_id' })
  property?: Property | null;

  @ManyToOne(() => Community, { nullable: true })
  @JoinColumn({ name: 'community_id' })
  community?: Community | null;
}
