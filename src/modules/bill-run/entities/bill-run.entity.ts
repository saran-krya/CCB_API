import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Property } from '../../property/entities/property.entity';
import { BillingCycleMaster } from '../../billing-cycle/entities/billing-cycle-master.entity';
import { BillingCycleVersion } from '../../billing-cycle/entities/billing-cycle-version.entity';
import { User } from '../../user/entities/user.entity';
import { BillRunBatch } from './bill-run-batch.entity';

// Real lifecycle only — no 'Dispatched'/invoice-triggering status exists because no Invoice module
// exists yet in this codebase (confirmed by a full-repo search before implementing this feature).
// APPROVED is the deliberate terminal "ready for invoice generation" state: a future Invoice module
// integrates by reading BillRun rows at this status, rather than this feature faking a dispatch step
// it cannot actually back with anything real.
export enum BillRunStatus {
  PENDING_APPROVAL = 'pending_approval',
  RETURNED_FOR_CORRECTION = 'returned_for_correction',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// One row per property + billing-cycle-version combination ever submitted. A rejected or
// returned-for-correction row is corrected-and-resubmitted as a NEW row (see BillRunService.resubmit)
// — the original stays exactly as it was, immutable, for a real audit history. Duplicate-prevention
// (one property+cycle can only ever have ONE currently-active row) is enforced by BillRunService
// inside a transaction (see its own doc comment) — a plain DB unique index can't express "unique
// except among rejected/returned rows", so the index below covers property+cycle+status instead,
// as a defense-in-depth backstop against a genuine race, not the primary guard.
@Entity('bill_runs')
@Index('IDX_bill_runs_property_cycle_status', ['propertyId', 'cycleVersionId', 'status'])
export class BillRun extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  @ManyToOne(() => BillRunBatch, (batch) => batch.billRuns, { nullable: true, eager: false })
  @JoinColumn({ name: 'batch_id' })
  batch?: BillRunBatch | null;

  @Column({ name: 'batch_id', nullable: true })
  batchId?: number | null;

  @ManyToOne(() => Property, { nullable: false })
  @JoinColumn({ name: 'property_id' })
  property!: Property;

  @Column({ name: 'property_id' })
  propertyId!: number;

  @ManyToOne(() => BillingCycleMaster, { nullable: false })
  @JoinColumn({ name: 'cycle_master_id' })
  cycleMaster!: BillingCycleMaster;

  @Column({ name: 'cycle_master_id' })
  cycleMasterId!: number;

  // The specific version whose reading-window/day-offset config this run was submitted against —
  // pinned at submission time so a later edit to the cycle's configuration never silently changes
  // what an already-submitted run means.
  @ManyToOne(() => BillingCycleVersion, { nullable: false })
  @JoinColumn({ name: 'cycle_version_id' })
  cycleVersion!: BillingCycleVersion;

  @Column({ name: 'cycle_version_id' })
  cycleVersionId!: number;

  @Column({ name: 'cycle_period_start', type: 'date' })
  cyclePeriodStart!: string;

  @Column({ name: 'cycle_period_end', type: 'date' })
  cyclePeriodEnd!: string;

  @Column({ name: 'bill_issue_date', type: 'date' })
  billIssueDate!: string;

  @Column({ name: 'bill_due_date', type: 'date' })
  billDueDate!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: BillRunStatus,
    default: BillRunStatus.PENDING_APPROVAL,
  })
  status!: BillRunStatus;

  // A snapshot of the real readiness/pre-bill-validation figures AT SUBMISSION TIME — not
  // recomputed later, so viewing an old bill run's validation results always shows what was
  // actually true when it was submitted, even if the property's live readiness has since changed.
  @Column({ name: 'billable_units', type: 'int' })
  billableUnits!: number;

  @Column({ name: 'units_missing_tariff', type: 'int' })
  unitsMissingTariff!: number;

  @Column({ name: 'units_missing_meter_mapping', type: 'int' })
  unitsMissingMeterMapping!: number;

  @Column({ name: 'units_missing_reading', type: 'int' })
  unitsMissingReading!: number;

  @Column({ name: 'critical_anomalies', type: 'int' })
  criticalAnomalies!: number;

  @Column({ name: 'high_anomalies', type: 'int' })
  highAnomalies!: number;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy?: User | null;

  @Column({ name: 'submitted_by_id', nullable: true })
  submittedById?: number | null;

  @Column({ name: 'submitted_on', type: 'datetime' })
  submittedOn!: Date;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'reviewed_by_id' })
  reviewedBy?: User | null;

  @Column({ name: 'reviewed_by_id', nullable: true })
  reviewedById?: number | null;

  @Column({ name: 'reviewed_on', type: 'datetime', nullable: true })
  reviewedOn?: Date | null;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes?: string | null;

  // Set only when this row was created by correcting-and-resubmitting a returned/rejected one —
  // points at that original row, forming a simple, real audit chain without full version numbering.
  @ManyToOne(() => BillRun, { nullable: true, eager: false })
  @JoinColumn({ name: 'resubmitted_from_id' })
  resubmittedFrom?: BillRun | null;

  @Column({ name: 'resubmitted_from_id', nullable: true })
  resubmittedFromId?: number | null;
}
