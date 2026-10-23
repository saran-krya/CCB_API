import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { PolicyStatement } from './policy-statement.entity';

/**
 * A reusable, named bundle of grants — attached to Roles via RolePolicy (many-to-many). Deleting a
 * Policy that is still attached to any Role is rejected at the service layer (mirrors RoleService's
 * own "can't delete a role with assigned users" precedent) rather than silently cascading, since a
 * silent cascade here would silently revoke access from every role holding it.
 */
@Entity('policies')
export class Policy extends BaseEntity {
  @Column({ unique: true })
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @OneToMany(() => PolicyStatement, (statement) => statement.policy, { cascade: true })
  statements?: PolicyStatement[];
}
