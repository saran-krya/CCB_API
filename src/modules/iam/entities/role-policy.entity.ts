import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Role } from '../../role/entities/role.entity';
import { Policy } from './policy.entity';

/**
 * Role <-> Policy many-to-many join — a Role can have multiple Policies attached, and a Policy can
 * be attached to multiple Roles (the whole point of "reusable"). Unique on (roleId, policyId): the
 * same Policy cannot be attached twice to the same Role.
 */
@Entity('role_policies')
@Index(['roleId', 'policyId'], { unique: true })
export class RolePolicy extends BaseEntity {
  // Mirrors the organization_id of both sides (nullable only because the SUPER_ADMIN role/policy
  // pairing is itself NULL) — kept directly on the join row, not just reachable via Role/Policy, so
  // service-layer attach logic can assert role.organizationId === policy.organizationId before
  // saving without an extra join, preventing a Role in one organization from ever being attached to
  // a Policy belonging to a different one.
  @Column({ name: 'organization_id', type: 'int', nullable: true })
  organizationId?: number | null;

  @Column()
  roleId!: number;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role?: Role;

  @Column()
  policyId!: number;

  @ManyToOne(() => Policy, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'policyId' })
  policy?: Policy;
}
