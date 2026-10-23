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
