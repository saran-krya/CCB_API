import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/**
 * A Resource is an authorization boundary — "the thing a Policy grants actions on" — deliberately
 * NOT the same concept as a PModule/SubModule/Screen (those remain the UI navigation tree,
 * unchanged by this module). Several Screens' Actions can map onto ONE Resource (e.g. both the
 * METER_LIST and METER_INVENTORY screens map onto the single METER resource, collapsing the
 * confirmed duplicate-code pattern the RBAC audit found: METER_VIEW/METER_INVENTORY_VIEW become one
 * statement on one resource instead of two parallel OR'd codes). See `resource-catalog.ts` for the
 * full, reviewed Resource-to-Action mapping covering all 96 existing Action codes.
 *
 * `parentResourceId` supports a shallow hierarchy (e.g. METER_INVENTORY as a child of METER) purely
 * for display grouping in the Policy editor's resource picker — it is NOT consulted by the
 * authorization engine for implicit grants (a Policy statement on a parent Resource does NOT
 * automatically grant access to its children); each statement names its own Resource explicitly.
 * This keeps evaluation simple and auditable (no hidden cascade), consistent with the "Allow-only,
 * no implicit inheritance" model this phase commits to.
 */
@Entity('resources')
export class Resource extends BaseEntity {
  @Column({ unique: true })
  code!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  parentResourceId?: number | null;

  @ManyToOne(() => Resource, (resource) => resource.children, { nullable: true })
  @JoinColumn({ name: 'parentResourceId' })
  parent?: Resource | null;

  @OneToMany(() => Resource, (resource) => resource.parent)
  children?: Resource[];

  @Column({ default: 0 })
  displayOrder!: number;
}
