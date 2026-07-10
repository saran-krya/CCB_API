import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
} from 'typeorm';

import { BaseEntity } from '@app/common/entities/base.entity';

import { Role } from '../../role/entities/role.entity';
import { PModule } from '../../pmodules/entities/pmodule.entity';
import { SubModule } from '../../sub-modules/entities/sub-module.entity';
import { Screen } from '../../screens/entities/screen.entity';
import { Action } from '../../actions/entities/action.entity';

// Composite index backs RolePermissionsService.roleHasAction() — the exact
// (roleId, actionId) pair PermissionGuard queries on every @Permission()
// -guarded request. Single-column FK indexes on roleId/actionId already
// exist, but MySQL can only use one of them per query without this;
// without it, the guard's per-request lookup narrows on one FK index and
// then filters the rest of those rows in memory instead of jumping
// straight to the match.
@Entity('role_permissions')
@Index(['roleId', 'actionId'])
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