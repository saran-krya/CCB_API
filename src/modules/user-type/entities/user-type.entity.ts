import {
  Column,
  Entity,
} from 'typeorm';

import { BaseEntity } from '../../../common/entities/base.entity';

@Entity('user_types')
export class UserType extends BaseEntity {
  @Column({
    unique: true,
    length: 100,
  })
  name!: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  description?: string;

  @Column({
    default: true,
  })
  isActive!: boolean;
}