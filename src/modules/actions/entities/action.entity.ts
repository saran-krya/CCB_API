import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
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
    nullable: true,
  })
  parentActionId?: number | null;

  @ManyToOne(
    () => Action,
    (action) => action.children,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({
    name: 'parentActionId',
  })
  parent?: Action | null;

  @OneToMany(
    () => Action,
    (action) => action.parent,
  )
  children?: Action[];

  @Column({
    unique: true,
  })
  name!: string;

  @Column({
    unique: true,
  })
  code!: string;

  // 500, matching Policy/Resource's own description column width — the default bare VARCHAR(255)
  // was too narrow for REGISTRATION_APPROVAL_DEPOSIT_MANAGE's seeded description (374 chars),
  // confirmed by a genuine fresh-install test (synchronize:true creates this column from this
  // decorator alone, since migrations run before synchronize does — see
  // 1788342228029-RefactorRegistrationRequestSchema's own comment for the cold-start evidence).
  @Column({
    nullable: true,
    length: 500,
  })
  description?: string;

  @Column({
    default: true,
  })
  isActive!: boolean;

  @Column({
    default: 0,
  })
  displayOrder!: number;

}