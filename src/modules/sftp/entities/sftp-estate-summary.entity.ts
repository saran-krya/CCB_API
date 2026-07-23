import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { EstateIngestionStatus } from './estate-ingestion-status.enum';

// One row per CALENDAR DATE — the estate-wide rollup EstateSummaryService
// computes by aggregating that date's SftpIngestionLog rows (see
// EstateSummaryService.generateSummaryForDate()). This is the ONLY table
// the Dashboard's read APIs (summary/trend/health/missing-files) query —
// they never iterate meter_readings or sftp_ingestion_logs directly (see
// EstateSummaryController), which is what keeps those endpoints under the
// spec's <500ms target regardless of how many files/readings a date has.
//
// Regenerated in full (not incrementally patched) every time
// EstateSummaryService.generateSummaryForDate()/recalculateSummary() runs —
// see that service for when: after every cron run and after every manual
// retrigger. summaryDate is unique so a regeneration is always an UPSERT
// against the same row, never a growing history of stale duplicates for one
// date.
@Entity('sftp_estate_summary')
@Index('UQ_sftp_estate_summary_date', ['summaryDate'], { unique: true })
@Index('IDX_sftp_estate_summary_status', ['ingestionStatus'])
export class SftpEstateSummary extends BaseEntity {
  @Column({ name: 'summary_date', type: 'date' })
  summaryDate!: string;

  @Column({ name: 'ingestion_status', type: 'enum', enum: EstateIngestionStatus, default: EstateIngestionStatus.FAILED })
  ingestionStatus!: EstateIngestionStatus;

  // Earliest processingStartedAt / latest processingCompletedAt across every
  // SftpIngestionLog row this date produced — NOT the cron run's own
  // start/end (same "never derive from cron-level timing" principle
  // IngestionService's per-file duration already follows). NULL when zero
  // rows exist for the date (EstateIngestionStatus.FAILED — the poll never
  // ran; see that enum).
  @Column({ name: 'ingestion_started_at', type: 'datetime', nullable: true })
  ingestionStartedAt?: Date | null;

  @Column({ name: 'ingestion_completed_at', type: 'datetime', nullable: true })
  ingestionCompletedAt?: Date | null;

  // ─── Files ──────────────────────────────────────────────────────────────
  // filesExpected = COUNT of the DTU Registry (master_meters.dtu_id IS NOT
  // NULL) as of generation time — NOT a count of that date's logs, since a
  // DTU that sent nothing has no PROCESSED/FAILED/DUPLICATE log row at all
  // (only a MISSING one). The other 4 below ARE straight per-file-status
  // counts of that date's SftpIngestionLog rows.
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

  // ─── Meters / readings ──────────────────────────────────────────────────
  // metersExpected = SUM, across the full DTU Registry, of each DTU's
  // Property's sub_meters count — a live registry figure, independent of
  // that date's logs (see EstateSummaryService for why
  // sftp_ingestion_logs.expected_meter_count alone can't be summed: it's
  // only ever populated on MISSING rows).
  @Column({ name: 'meters_expected', type: 'int', unsigned: true, default: 0 })
  metersExpected!: number;

  // SUM(received_meter_count) across that date's logs.
  @Column({ name: 'meters_received', type: 'int', unsigned: true, default: 0 })
  metersReceived!: number;

  // SUM(valid_reading_count) across that date's logs.
  @Column({ name: 'valid_readings', type: 'int', unsigned: true, default: 0 })
  validReadings!: number;

  // SUM(anomaly_count) across that date's logs.
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

  // validReadings + anomalyCount — deliberately NOT a meter_readings row
  // count (that would only capture valid readings; a meter that sent a row
  // which failed validation is still an active meter that reported
  // something, just not something usable).
  @Column({ name: 'active_meters', type: 'int', unsigned: true, default: 0 })
  activeMeters!: number;

  // (validReadings / metersExpected) * 100 — per the spec, deliberately NOT
  // valid/received (that would hide DTUs that sent nothing at all from the
  // quality score entirely; dividing by the full estate's expected capacity
  // is what makes a missing DTU actually cost data_quality_pct points).
  // 0.00 when metersExpected is 0 (nothing registered yet — avoids a
  // division by zero, not a real quality signal).
  @Column({ name: 'data_quality_pct', type: 'decimal', precision: 5, scale: 2, default: 0 })
  dataQualityPct!: string;
}
