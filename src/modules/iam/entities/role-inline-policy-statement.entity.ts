import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { PolicyEffect } from './policy-statement.entity';
import { Resource } from './resource.entity';
import { RoleInlinePolicy } from './role-inline-policy.entity';

/**
 * One statement of a role's inline policy — identical in meaning to PolicyStatement ("allow these
 * Action codes on this Resource"; `actions` stores Action codes validated against the real catalog by
 * IamService.validateStatements, `effect` is always 'Allow'), kept in its own table so a role's inline
 * policies never mix with the shared, many-roles-attachable policy_statements. Mirrors
 * UserInlinePolicyStatement exactly, one level up (Role instead of User).
 */
@Entity('role_inline_policy_statements')
export class RoleInlinePolicyStatement extends BaseEntity {
  @Column()
  policyId!: number;

  @ManyToOne(() => RoleInlinePolicy, (policy) => policy.statements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'policyId' })
  policy?: RoleInlinePolicy;

  @Column()
  resourceId!: number;

  @ManyToOne(() => Resource, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'resourceId' })
  resource?: Resource;

  @Column({ type: 'varchar', length: 10, default: 'Allow' })
  effect!: PolicyEffect;

  @Column({ type: 'json' })
  actions!: string[];
}
