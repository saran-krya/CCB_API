import { BaseEntity } from '@app/common/entities/base.entity';
import { SubModule } from '@app/modules/sub-modules/entities/sub-module.entity';
import {
    Column,
    Entity,
    OneToMany,
} from 'typeorm';

@Entity('pmodules')
export class PModule extends BaseEntity {
    @Column({
        unique: true,
    })
    moduleName!: string;

    @Column({
        nullable: true,
    })
    icon?: string;

    @Column({
        default: 0,
    })
    displayOrder?: number;

    @Column({
        unique: true,
    })
    code!: string;

    @Column({
        default: true,
    })
    isActive?: boolean;

    // MENU | PAGE
    @Column({
        length: 20,
        default: 'MENU',
    })
    type!: string;

    // Direct route if module opens a page
    @Column({
        nullable: true,
        length: 255,
    })
    url?: string;

    @OneToMany(
        () => SubModule,
        (subModule) => subModule.pModule,
    )
    subModules!: SubModule[];
}