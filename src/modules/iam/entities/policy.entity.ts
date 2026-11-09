import { AfterLoad, Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { PolicyStatement } from './policy-statement.entity';

/** The two kinds of policy, worded once here — everything that shows a policy's type reads it from the API. */
export const POLICY_TYPE_LABEL = { system: 'System', custom: 'Custom' } as const;

/**
 * A reusable, named bundle of grants — attached to Roles via RolePolicy (many-to-many). Deleting a
 * Policy that is still attached to any Role is rejected at the service layer (mirrors RoleService's
 * own "can't delete a role with assigned users" precedent) rather than silently cascading, since a
 * silent cascade here would silently revoke access from every role holding it.
 */
// Organization-scoped uniqueness: two different organizations may each have their own policy named
// the same thing (e.g. "Finance Manager") — only `organization_id IS NULL` (the one SUPER_ADMIN
// system policy) is exempt from colliding with a real organization's policy of the same name, since
// NULL never equals NULL in a unique index. Replaces the old plain `unique: true` on `name` alone.
@Entity('policies')
@Index(['organizationId', 'name'], { unique: true })
export class Policy extends BaseEntity {
  // NULL reserved exclusively for the one SUPER_ADMIN system-managed policy (see
  // IamService.ensureAdminPolicyGrants) — every organization-scoped policy carries a real
  // organization_id.
  @Column({ name: 'organization_id', type: 'int', nullable: true })
  organizationId?: number | null;

  @Column({ length: 150 })
  name!: string;

  @Column({ nullable: true, length: 500 })
  description?: string;

  // Set ONLY by IamService.ensureAdminPolicyGrants, the boot-time path that creates/reconciles the
  // SUPER_ADMIN Policy — never settable via CreatePolicyDto/UpdatePolicyDto, so no SUPER_ADMIN
  // session can mark an ordinary policy "system" to make it undeletable, and no admin can create a
  // second system-managed policy through the API. IamService.updatePolicy/removePolicy/
  // detachPolicyFromRole all check this flag (never the policy's name) before allowing a mutation —
  // see those methods' own doc comments for the exact enforcement.
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @OneToMany(() => PolicyStatement, (statement) => statement.policy, { cascade: true })
  statements?: PolicyStatement[];

  // Not a column: filled in whenever a policy is loaded, so every response that carries a policy also carries
  // its type wording — the web client never turns `isSystem` into text itself.
  typeLabel?: string;

  @AfterLoad()
  setTypeLabel(): void {
    this.typeLabel = this.isSystem ? POLICY_TYPE_LABEL.system : POLICY_TYPE_LABEL.custom;
  }
}
