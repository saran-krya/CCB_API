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

  // Self-referencing — supports exactly one level of nesting (a child action
  // cannot itself be a parent, enforced in ActionsService). Lets a Screen's
  // top-level action (e.g. "Edit Tariff") group its own related sub-actions
  // (e.g. "Deactivate", "Reactivate") as independently grantable children in
  // the Role Permission tree, instead of every action being a flat peer.
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

  @Column({
    nullable: true,
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