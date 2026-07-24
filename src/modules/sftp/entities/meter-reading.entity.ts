import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { SftpIngestionLog } from './sftp-ingestion-log.entity';
import { SubMeter } from '../../meter/entities/sub-meter.entity';
import { Unit } from '../../unit/entities/unit.entity';
import { Property } from '../../property/entities/property.entity';
import { Community } from '../../community/entities/community.entity';
import { AnomalySeverity } from '../validation.service';

// meter_id -> ANM code, for rows that fail ValidationService.validateRows().
// This is deliberately a NEW, small scheme reflecting what validateRows()
// actually checks (field presence/format) — not the Daily Meter Readings
// mock UI's ANM-101..110 codes, which represent statistical pattern
// anomalies (spikes, drops, tamper/DTU-offline detection) that no service
// in this codebase computes. Reusing those codes for a simple field-
// validation failure would misrepresent what was actually detected.
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

// Billing-readiness gate, separate from validationStatus (which is immutable
// after ingestion). A Clean reading is auto-approved by the system at
// ingestion time — standard utility billing practice, since a reading that
// passed every field check needs no human judgment call. An Anomaly reading
// stays Pending until Operations reviews it; there is no auto-approval path
// for Anomaly rows. approvedBy is a plain string (not a User FK) because the
// only two writers today are the system itself ('SYSTEM') and, eventually,
// whichever operator manually approves a Pending row — this table doesn't
// need a relational audit trail beyond that label.
export enum ReadingApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
}

// One row per meter reading — now covers every outcome (Clean, Anomaly,
// Missing), not just successfully-validated rows. validationStatus is the
// authoritative discriminator; anomalyCode/anomalySeverity/anomalyMessage
// are only ever set when validationStatus = ANOMALY. A MISSING row has no
// real CSV data behind it at all (see MissingMeterReadingService) — hence
// readingValue/unit/sourceFile are all nullable.
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

  // Nullable — an Anomaly row can fail precisely because this value was
  // missing/non-numeric; a Missing row has no reading at all.
  @Column({ name: 'reading_value', type: 'decimal', precision: 14, scale: 4, nullable: true })
  readingValue?: string | null;

  // Nullable for the same reason as readingValue.
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

  // Set automatically at ingestion time based on validationStatus — see
  // IngestionService.ingestFile()'s row-mapping step. Clean → APPROVED
  // immediately; Anomaly → stays PENDING until reviewed. Never defaulted at
  // the DB level to PENDING-for-everyone, because the auto-approval decision
  // depends on validationStatus, which only the application layer knows at
  // insert time.
  @Column({ name: 'approval_status', type: 'enum', enum: ReadingApprovalStatus, default: ReadingApprovalStatus.PENDING })
  approvalStatus!: ReadingApprovalStatus;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt?: Date | null;

  // Plain label, not a User FK — see ReadingApprovalStatus's doc comment.
  @Column({ name: 'approved_by', type: 'varchar', length: 100, nullable: true })
  approvedBy?: string | null;

  // FK column named explicitly (source_file_id), matching every other
  // ManyToOne in this codebase (see MasterMeter.property / SubMeter.masterMeter
  // for the same pattern) — this is also the physical column
  // IDX_meter_readings_source_file_id above indexes.
  //
  // Nullable — a MISSING row isn't tied to any one ingested file (nothing
  // was received for that meter at all, so there's no file to point at).
  // Clean/Anomaly rows always have a real sourceFile.
  //
  // ON DELETE CASCADE: deleting a SftpIngestionLog row removes every
  // Clean/Anomaly MeterReading that came from that file.
  @ManyToOne(() => SftpIngestionLog, (log) => log.meterReadings, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_file_id' })
  sourceFile?: SftpIngestionLog | null;

  // Meter hierarchy resolution (meter_id -> SubMeter.businessCode -> Unit ->
  // Property -> Community), populated by MeterHierarchyResolverService at
  // ingestion time. All nullable — a meter_id with no matching SubMeter
  // still gets a MeterReading row, just without these resolved (existing
  // validation/anomaly handling is entirely unaffected either way).
  @ManyToOne(() => SubMeter, { nullable: true })
  @JoinColumn({ name: 'sub_meter_id' })
  subMeter?: SubMeter | null;

  // Named propertyUnit, not `unit` — this entity's own `unit` column above
  // already means "unit of measure" (e.g. "m3"/"kWh"), a different concept
  // from the Unit entity (a physical property unit/apartment).
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
