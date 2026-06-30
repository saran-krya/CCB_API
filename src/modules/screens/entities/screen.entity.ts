import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
} from 'typeorm';

import { BaseEntity } from '@app/common/entities/base.entity';
import { SubModule } from '../../sub-modules/entities/sub-module.entity';
import { Action } from '../../actions/entities/action.entity';

@Entity('screens')
export class Screen extends BaseEntity {
    @Column()
    subModuleId!: number;

    @ManyToOne(
        () => SubModule,
        (subModule) => subModule.screens,
    )
    @JoinColumn({
        name: 'subModuleId',
    })
    subModule!: SubModule;

    @Column()
    name!: string;

    @Column({
        type: 'varchar',
        length: 255,
        nullable: true,
    })
    url!: string | null;

    @Column({
        type: 'varchar',
        length: 100,
        unique: true,
    })
    code!: string;


    @Column({ default: 0 })
    displayOrder!: number;

    @Column({ default: true })
    isActive!: boolean;

    @OneToMany(
        () => Action,
        (action) => action.screen,
    )
    actions!: Action[];
}