import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import { BaseEntity } from '@app/common/entities/base.entity';
import { Screen } from '../../screens/entities/screen.entity';

@Entity('actions')
export class Action extends BaseEntity {
  @Column({
    nullable: true,
  })
  screenId?: number;

  @ManyToOne(
    () => Screen,
    (screen) => screen.actions,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({
    name: 'screenId',
  })
  screen?: Screen;


  @Column({
    unique: true,
  })
  name!: string;

  @Column({
    unique: true,
  })
  code!: string;

  @Column({
    nullable: true,
  })
  description?: string;

  @Column({
    default: true,
  })
  isActive!: boolean;

}