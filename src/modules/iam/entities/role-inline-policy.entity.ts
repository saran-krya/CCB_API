import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Role } from '../../role/entities/role.entity';
import { RoleInlinePolicyStatement } from './role-inline-policy-statement.entity';

/**
 * A policy that belongs to exactly ONE role (the Role-level mirror of `UserInlinePolicy` — AWS IAM's
 * "inline policy" pattern applied to a Role instead of a User), as opposed to the reusable,
 * many-roles-attachable `Policy`. Its grants are added to whatever the role's attached Policies
 * already grant, and — because every user who holds this role inherits it — effectively to every
 * one of that role's users too: a role's effective grants are the UNION of its attached Policies'
 * statements and its own inline policies' statements, resolved live on every request by IamService
 * (see getActionCodesGrantedByPoliciesForRoles) — so deleting a role's inline policy revokes its
 * grants, for every holder of that role, on their very next request.
 *
 * Deliberately a separate table from `policies`, not a `policies` row with an owner column — same
 * reasoning as `UserInlinePolicy`: every existing consumer of `policies` (the shared Policy
 * Management list, attach/detach, per-role counts, ensureAdminPolicyGrants) assumes a Policy is a
 * shared, many-roles-attachable object, and a role's inline policy must never be listed there or
 * attached to another Role. Rows are only ever HARD-deleted so the unique (roleId, name) key is
 * never held by a soft-deleted row.
 */
@Entity('role_inline_policies')
@Index(['roleId', 'name'], { unique: true })
export class RoleInlinePolicy extends BaseEntity {
  @Column()
  roleId!: number;

  @ManyToOne(() => Role, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role?: Role;

  @Column({ length: 150 })
  name!: string;

  // `| null` so an edit can CLEAR the description (an omitted/undefined field is skipped by TypeORM and
  // would silently keep the old text) — same convention as UserInlinePolicy.description.
  @Column({ type: 'varchar', nullable: true, length: 500 })
  description?: string | null;

  @OneToMany(() => RoleInlinePolicyStatement, (statement) => statement.policy, { cascade: true })
  statements?: RoleInlinePolicyStatement[];
}
