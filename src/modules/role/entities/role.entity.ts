import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import { BaseEntity } from '../../../common/entities/base.entity';
import { LovValue } from '../../lov/entities/lov-value.entity';

// Organization-scoped uniqueness: two different organizations may each have their own role named the
// same thing — only `organization_id IS NULL` (the one SUPER_ADMIN role) is exempt, since NULL never
// equals NULL in a unique index. SUPER_ADMIN itself stays globally reserved regardless, enforced at
// the application layer (RoleService.RESERVED_ROLE_NAMES), independent of this DB constraint.
@Entity('roles')
@Index(['organizationId', 'roleName'], { unique: true })
export class Role extends BaseEntity {
  // NULL reserved exclusively for the one platform SUPER_ADMIN role — every organization-scoped role
  // (including each organization's own auto-created ADMIN role) carries a real organization_id.
  @Column({ name: 'organization_id', type: 'int', nullable: true })
  organizationId?: number | null;

  @Column({
    name: 'role_name',
    type: 'varchar',
    length: 80,
  })
  roleName!: string;

  @Column({
    name: 'role_description',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  roleDescription?: string;

  @Column({
    name: 'user_category_id',
    nullable: true,
  })
  userCategoryId!: number;

  @ManyToOne(() => LovValue, {
    eager: true,
  })
  @JoinColumn({
    name: 'user_category_id',
  })
  userCategory!: LovValue;

  @Column({
    name: 'can_be_reporting_manager',
    default: false,
  })
  canBeReportingManager!: boolean;

  // Same pattern as canBeReportingManager above — a per-role flag marking users of this role as
  // eligible field-inspection assignees (Request Field Inspection's "Assign To" picker), rather than
  // a separate Team/Department entity this codebase has no other use for.
  @Column({
    name: 'can_be_field_inspector',
    default: false,
  })
  canBeFieldInspector!: boolean;
}