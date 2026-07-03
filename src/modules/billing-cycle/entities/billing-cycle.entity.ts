import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Community } from '../../community/entities/community.entity';
import { Property } from '../../property/entities/property.entity';

export enum BillingCycleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
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

  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;
}
