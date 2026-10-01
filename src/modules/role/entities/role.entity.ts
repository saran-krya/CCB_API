import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import { BaseEntity } from '../../../common/entities/base.entity';
import { LovValue } from '../../lov/entities/lov-value.entity';

@Entity('roles')
export class Role extends BaseEntity {
  @Column({
    name: 'role_name',
    type: 'varchar',
    length: 80,
    unique: true,
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