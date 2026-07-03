import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
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
    name: 'user_type_id',
  })
  userTypeId!: number;

  @ManyToOne(() => LovValue, {
    eager: true,
  })
  @JoinColumn({
    name: 'user_type_id',
  })
  userType!: LovValue;

  @Column({
    name: 'can_be_reporting_manager',
    default: false,
  })
  canBeReportingManager!: boolean;

  @OneToMany(
    () => User,
    (user) => user.role,
  )
  users!: User[];
}