import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Community } from '../../community/entities/community.entity';
import { Property } from '../../property/entities/property.entity';
import { User } from '../../user/entities/user.entity';

export enum BillingCycleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
  REJECTED = 'rejected',
  DEPRECATED = 'deprecated',
}

@Entity('billing_cycles')
export class BillingCycle extends BaseEntity {
  @ManyToOne(() => Community)
  @JoinColumn({ name: 'community_id' })
  community!: Community;

  @Column({ name: 'community_id' })
  communityId!: number;

  @ManyToOne(() => Property)
  @JoinColumn({ name: 'property_id' })
  property!: Property;

  @Column({ name: 'property_id' })
  propertyId!: number;

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
    default: BillingCycleStatus.INACTIVE,
  })
  status!: BillingCycleStatus;

  @Column({ name: 'last_change_reason', type: 'text', nullable: true })
  lastChangeReason?: string | null;

  // Code from LOV category BILLING_CYCLE_CHANGE_REASON (Lookup Field Master).
  @Column({ name: 'change_reason_code', type: 'varchar', length: 50, nullable: true })
  changeReasonCode?: string | null;

  // Shared across every version of the same property's cycle (v1.0, v2.0,
  // ...) — no longer unique, since a new version deliberately reuses it.
  @Column({ name: 'business_code', type: 'varchar', length: 20, nullable: true })
  businessCode?: string | null;

  @Column({ name: 'version', type: 'varchar', length: 10, default: '1.0' })
  version!: string;

  // Self-reference to the version this one was cloned from via newVersion().
  // Null for a property's first (v1.0) cycle.
  @ManyToOne(() => BillingCycle, { nullable: true, eager: false })
  @JoinColumn({ name: 'parent_billing_cycle_id' })
  parentBillingCycle?: BillingCycle | null;

  @OneToMany(() => BillingCycle, (cycle) => cycle.parentBillingCycle)
  childVersions!: BillingCycle[];

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
