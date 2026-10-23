import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Policy } from './policy.entity';
import { Resource } from './resource.entity';

/**
 * One statement = "this Policy allows these Action codes on this Resource." `actions` stores Action
 * *codes* (e.g. 'VIEW_CUSTOMER'), not a foreign key to the existing Action table — the Action
 * catalog (name/description/screen/parent, used by the Policy editor's tree UI) stays exactly as it
 * is; a statement just references which of those codes it grants, the same way an AWS IAM statement
 * lists action strings rather than foreign keys into a separate "action" table. This avoids a
 * disruptive migration of the existing, working Action table, and keeps the Action catalog as the
 * single source of truth for which codes exist at all — PolicyStatementsService validates every
 * code against it before saving (see that service's own validation, never trust client input here).
 *
 * `effect` is modeled as a column now (schema future-proofing) but its value is hardcoded to
 * 'Allow' everywhere in this phase — introducing and evaluating 'Deny' is explicitly out of scope,
 * deferred to a separate, later design per the approved architecture plan.
 */
export type PolicyEffect = 'Allow';

@Entity('policy_statements')
export class PolicyStatement extends BaseEntity {
  @Column()
  policyId!: number;

  @ManyToOne(() => Policy, (policy) => policy.statements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'policyId' })
  policy?: Policy;

  @Column()
  resourceId!: number;

  @ManyToOne(() => Resource, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'resourceId' })
  resource?: Resource;

  @Column({ type: 'varchar', length: 10, default: 'Allow' })
  effect!: PolicyEffect;

  @Column({ type: 'simple-json' })
  actions!: string[];
}
