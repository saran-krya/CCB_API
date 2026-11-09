import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/**
 * A reusable subscription-plan catalog, SUPER_ADMIN-managed. Limits are hard-enforced (e.g. `maxUsers`
 * rejects the (maxUsers + 1)th active staff user in an organization on that plan) and configurable per
 * plan rather than hardcoded anywhere — a `null` limit means "unlimited" for that dimension.
 */
@Entity('subscription_plans')
export class SubscriptionPlan extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ name: 'max_users', type: 'int', nullable: true })
  maxUsers?: number | null;

  @Column({ name: 'max_communities', type: 'int', nullable: true })
  maxCommunities?: number | null;

  @Column({ name: 'max_properties', type: 'int', nullable: true })
  maxProperties?: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;
}
