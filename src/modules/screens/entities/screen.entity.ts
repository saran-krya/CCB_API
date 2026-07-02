import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
} from 'typeorm';

import { BaseEntity } from '@app/common/entities/base.entity';
import { SubModule } from '../../sub-modules/entities/sub-module.entity';
import { PModule } from '../../pmodules/entities/pmodule.entity';
import { Action } from '../../actions/entities/action.entity';

@Entity('screens')
export class Screen extends BaseEntity {
    @Column({ nullable: true })
    subModuleId?: number | null;

    @ManyToOne(
        () => SubModule,
        (subModule) => subModule.screens,
        { nullable: true },
    )
    @JoinColumn({ name: 'subModuleId' })
    subModule?: SubModule | null;

    @Column({ nullable: true })
    pModuleId?: number | null;

    @ManyToOne(
        () => PModule,
        (pModule) => pModule.screens,
        { nullable: true },
    )
    @JoinColumn({ name: 'pModuleId' })
    pModule?: PModule | null;

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
