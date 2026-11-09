import { Column, Entity, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { SubscriptionPlan } from './subscription-plan.entity';

/**
 * The SaaS tenant lifecycle. PENDING = created but the invited Tenant ADMIN hasn't activated yet;
 * ACTIVE = normal operation; SUSPENDED = explicitly paused by SUPER_ADMIN (e.g. non-payment) — data is
 * preserved, login/API access is blocked, only platform-level operations remain reachable; INACTIVE =
 * offboarded. Transitions are validated in OrganizationService, not left to callers — see that file's
 * ALLOWED_STATUS_TRANSITIONS map.
 */
export enum OrganizationStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  INACTIVE = 'inactive',
}

export enum OrganizationType {
  RESIDENTIAL = 'residential',
  COMMERCIAL = 'commercial',
  MIXED_USE = 'mixed_use',
  OTHER = 'other',
}

/**
 * A CCB SaaS client (a company that has purchased the platform) — the tenant-isolation root every
 * business-owned row ultimately belongs to. Deliberately distinct from `Company` (an existing, unrelated
 * entity: a Trade-License/TRN profile of one Corporate Customer *within* a tenant) — never confuse or
 * merge the two. The platform's own SUPER_ADMIN user/role belong to no Organization at all
 * (organization_id stays NULL on those rows specifically), since SUPER_ADMIN is platform-level, not
 * tenant-level.
 */
@Entity('organizations')
export class Organization extends BaseEntity {
  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({
    name: 'organization_type',
    type: 'enum',
    enum: OrganizationType,
    default: OrganizationType.OTHER,
  })
  type!: OrganizationType;

  @Column({ name: 'primary_contact_name', type: 'varchar', length: 160 })
  primaryContactName!: string;

  @Column({ name: 'primary_contact_email', type: 'varchar', length: 160 })
  primaryContactEmail!: string;

  @Column({ name: 'primary_contact_phone', type: 'varchar', length: 30, nullable: true })
  primaryContactPhone?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country?: string | null;

  @Column({ type: 'varchar', length: 64, default: 'UTC' })
  timezone!: string;

  @Column({
    name: 'organization_status',
    type: 'enum',
    enum: OrganizationStatus,
    default: OrganizationStatus.PENDING,
  })
  status!: OrganizationStatus;

  @ManyToOne(() => SubscriptionPlan, { nullable: true })
  @JoinColumn({ name: 'subscription_plan_id' })
  subscriptionPlan?: SubscriptionPlan | null;

  @Column({ name: 'subscription_plan_id', type: 'int', nullable: true })
  subscriptionPlanId?: number | null;

  @Column({ name: 'subscription_start_date', type: 'date', nullable: true })
  subscriptionStartDate?: string | null;

  @Column({ name: 'subscription_expiry_date', type: 'date', nullable: true })
  subscriptionExpiryDate?: string | null;
}
