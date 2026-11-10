import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Community } from '../../community/entities/community.entity';
import { Property } from '../../property/entities/property.entity';
import { BillingCycleVersion } from './billing-cycle-version.entity';

@Entity('billing_cycle_masters')
export class BillingCycleMaster extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  @ManyToOne(() => Community)
  @JoinColumn({ name: 'community_id' })
  community!: Community;

  @Column({ name: 'community_id' })
  communityId!: number;

  @ManyToOne(() => Property)
  @JoinColumn({ name: 'property_id' })
  property!: Property;

  @Column({ name: 'property_id', unique: true })
  propertyId!: number;

  @OneToOne(() => BillingCycleVersion, { nullable: true, eager: false })
  @JoinColumn({ name: 'current_version_id' })
  currentVersion?: BillingCycleVersion | null;

  @Column({ name: 'current_version_id', nullable: true })
  currentVersionId?: number | null;

  @OneToMany(() => BillingCycleVersion, (version) => version.master)
  versions!: BillingCycleVersion[];
}
