import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { BillingCycleMaster } from './billing-cycle-master.entity';

export enum BillingCycleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
  REJECTED = 'rejected',
  DEPRECATED = 'deprecated',
}

// One row per version (v1.0, v2.0, ...) of a property's billing cycle.
// Everything that actually varies by version lives here; everything that
// identifies WHICH property this is lives on BillingCycleMaster instead —
// see that entity's comment for why (stable external reference point,
// O(1) "current version" lookup instead of a filtered scan).
@Entity('billing_cycle_versions')
export class BillingCycleVersion extends BaseEntity {
  @ManyToOne(() => BillingCycleMaster, (master) => master.versions, { nullable: false })
  @JoinColumn({ name: 'master_id' })
  master!: BillingCycleMaster;

  @Column({ name: 'master_id' })
  masterId!: number;

  @Column({ name: 'frequency', type: 'varchar', length: 50, default: 'monthly' })
  frequency!: string;

  @Column({ name: 'reading_start_day', type: 'smallint' })
  readingStartDay!: number;

  @Column({ name: 'reading_end_day', type: 'smallint' })
  readingEndDay!: number;

  @Column({ name: 'bill_generation_days', type: 'smallint', default: 0 })
  billGenerationDays!: number;

  @Column({ name: 'bill_issue_days', type: 'smallint', default: 0 })
  billIssueDays!: number;

  @Column({ name: 'bill_due_days', type: 'smallint', default: 1 })
  billDueDays!: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: BillingCycleStatus,
    default: BillingCycleStatus.ACTIVE,
  })
  status!: BillingCycleStatus;

  @Column({ name: 'last_change_reason', type: 'text', nullable: true })
  lastChangeReason?: string | null;

  // Code from LOV category BILLING_CYCLE_CHANGE_REASON (Lookup Field Master).
  @Column({ name: 'change_reason_code', type: 'varchar', length: 50, nullable: true })
  changeReasonCode?: string | null;

  @Column({ name: 'version', type: 'varchar', length: 10, default: '1.0' })
  version!: string;

  // Self-reference to the version this one was cloned from via newVersion().
  // Scoped purely to version lineage now — never points across masters.
  // Null for a property's first (v1.0) version.
  @ManyToOne(() => BillingCycleVersion, { nullable: true, eager: false })
  @JoinColumn({ name: 'parent_version_id' })
  parentVersion?: BillingCycleVersion | null;

  @OneToMany(() => BillingCycleVersion, (version) => version.parentVersion)
  childVersions!: BillingCycleVersion[];

  // Date this version should take over as the governing cycle for its
  // property. Set on newVersion(), consumed by the scheduler (or
  // immediately by approve(), if already reached at approval time).
  @Column({ name: 'effective_from', type: 'date', nullable: true })
  effectiveFrom?: string | null;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy?: User | null;

  @Column({ name: 'submitted_on', type: 'date', nullable: true })
  submittedOn?: string | null;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'approved_by_id' })
  approvedBy?: User | null;

  @Column({ name: 'approval_date', type: 'date', nullable: true })
  approvalDate?: string | null;

  @Column({ name: 'rejection_notes', type: 'text', nullable: true })
  rejectionNotes?: string | null;

  // Code from LOV category BILLING_CYCLE_DEPRECATION_REASON.
  @Column({ name: 'deprecation_reason_code', type: 'varchar', length: 50, nullable: true })
  deprecationReasonCode?: string | null;

  @Column({ name: 'deprecation_notes', type: 'text', nullable: true })
  deprecationNotes?: string | null;

  @Column({ name: 'deprecated_on', type: 'date', nullable: true })
  deprecatedOn?: string | null;
}
