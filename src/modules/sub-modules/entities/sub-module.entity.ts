import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

import { BaseEntity } from '@app/common/entities/base.entity';

import { PModule } from '../../pmodules/entities/pmodule.entity';
import { Screen } from '../../screens/entities/screen.entity';

@Entity('sub_modules')
export class SubModule extends BaseEntity {
  @Column()
  pModuleId!: number;

  @ManyToOne(
    () => PModule,
    (pModule) => pModule.subModules,
  )
  @JoinColumn({
    name: 'pModuleId',
  })
  pModule!: PModule;

  @Column()
  name!: string;

  @Column({
    unique: true,
  })
  code!: string;

  @Column({
    nullable: true,
  })
  icon?: string;

  @Column({
    nullable: true,
  })
  url?: string;

  @Column({
    default: 0,
  })
  displayOrder!: number;

  @Column({
    default: true,
  })
  isActive!: boolean;

  @OneToMany(
    () => Screen,
    (screen) => screen.subModule,
  )
  screens!: Screen[];
}