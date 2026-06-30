import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
} from 'typeorm';

import { BaseEntity } from '@app/common/entities/base.entity';

import { Role } from '../../role/entities/role.entity';
import { PModule } from '../../pmodules/entities/pmodule.entity';
import { SubModule } from '../../sub-modules/entities/sub-module.entity';
import { Screen } from '../../screens/entities/screen.entity';
import { Action } from '../../actions/entities/action.entity';

@Entity('role_permissions')
export class RolePermission extends BaseEntity {
    @Column()
    roleId!: number;

    @ManyToOne(() => Role, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({
        name: 'roleId',
    })
    role!: Role;

    @Column()
    moduleId!: number;

    @ManyToOne(() => PModule, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({
        name: 'moduleId',
    })
    module!: PModule;

    @Column({
        nullable: true,
    })
    subModuleId?: number | null;

    @ManyToOne(() => SubModule, {
        nullable: true,
        onDelete: 'CASCADE',
    })
    @JoinColumn({
        name: 'subModuleId',
    })
    subModule?: SubModule | null;

    @Column({
        nullable: true,
    })
    screenId?: number | null;

    @ManyToOne(() => Screen, {
        nullable: true,
        onDelete: 'CASCADE',
    })
    @JoinColumn({
        name: 'screenId',
    })
    screen?: Screen | null;

    @Column({
        nullable: true,
    })
    actionId?: number | null;

    @ManyToOne(() => Action, {
        nullable: true,
        onDelete: 'CASCADE',
    })
    @JoinColumn({
        name: 'actionId',
    })
    action?: Action | null;
}