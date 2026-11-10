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

  @Column({ name: 'change_reason_code', type: 'varchar', length: 50, nullable: true })
  changeReasonCode?: string | null;

  @Column({ name: 'version', type: 'varchar', length: 10, default: '1.0' })
  version!: string;

  @ManyToOne(() => BillingCycleVersion, { nullable: true, eager: false })
  @JoinColumn({ name: 'parent_version_id' })
  parentVersion?: BillingCycleVersion | null;

  @OneToMany(() => BillingCycleVersion, (version) => version.parentVersion)
  childVersions!: BillingCycleVersion[];

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

  @Column({ name: 'deprecation_reason_code', type: 'varchar', length: 50, nullable: true })
  deprecationReasonCode?: string | null;

  @Column({ name: 'deprecation_notes', type: 'text', nullable: true })
  deprecationNotes?: string | null;

  @Column({ name: 'deprecated_on', type: 'date', nullable: true })
  deprecatedOn?: string | null;
}
