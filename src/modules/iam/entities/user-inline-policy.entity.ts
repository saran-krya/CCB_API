import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { UserInlinePolicyStatement } from './user-inline-policy-statement.entity';

/**
 * A policy that belongs to exactly ONE user (AWS IAM's "inline policy"), as opposed to the reusable,
 * role-attached `Policy`. Its grants are added to whatever the user's roles already grant: a user's
 * effective permissions are the UNION of their roles' Policies and their own inline policies, resolved
 * live on every request by IamService (see getActionCodesGrantedByPoliciesForRoles) — so deleting an
 * inline policy revokes its grants on the user's very next request.
 *
 * Deliberately a separate table from `policies`, not a `policies` row with an owner column: every
 * existing consumer of `policies` (the shared Policy Management list, attach/detach, per-role counts,
 * ensureAdminPolicyGrants) assumes a Policy is a shared, role-attachable object, and an inline policy
 * must never be listed there or attached to a Role. Rows are only ever HARD-deleted so the unique
 * (userId, name) key is never held by a soft-deleted row.
 */
@Entity('user_inline_policies')
@Index(['userId', 'name'], { unique: true })
export class UserInlinePolicy extends BaseEntity {
  @Column()
  userId!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ length: 150 })
  name!: string;

  // `| null` so an edit can CLEAR the description (an omitted/undefined field is skipped by TypeORM and
  // would silently keep the old text).
  @Column({ type: 'varchar', nullable: true, length: 500 })
  description?: string | null;

  @OneToMany(() => UserInlinePolicyStatement, (statement) => statement.policy, { cascade: true })
  statements?: UserInlinePolicyStatement[];
}
