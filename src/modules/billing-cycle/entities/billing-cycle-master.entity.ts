import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Community } from '../../community/entities/community.entity';
import { Property } from '../../property/entities/property.entity';
import { BillingCycleVersion } from './billing-cycle-version.entity';

// The stable identity of "this property's billing cycle" — created exactly
// once per property, on the first-ever create(). Every subsequent
// newVersion() adds a row to billing_cycle_versions under this same master;
// it never creates a second master for the same property.
//
// currentVersionId is a maintained pointer to whichever version is
// presently governing (status ACTIVE or INACTIVE — i.e. "live", on or off)
// — kept in sync by BillingCycleService whenever a version activates or a
// governing version is deprecated. This replaces the old single-table
// design's findByProperty(), which had to scan/filter for "prefer ACTIVE,
// else most recent non-deprecated" on every read; here it's a direct FK
// lookup, and it's also the stable reference point future modules (Billing
// Engine, Contract Management, Invoice) can hold onto without it going
// stale the moment a version gets superseded.
@Entity('billing_cycle_masters')
export class BillingCycleMaster extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  @ManyToOne(() => Community)
  @JoinColumn({ name: 'community_id' })
  community!: Community;

  @Column({ name: 'community_id' })
  communityId!: number;

  // Unique — a property has at most one billing cycle master, ever.
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
