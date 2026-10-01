import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { Role } from '../../role/entities/role.entity';

/**
 * The User -> Role mapping — the ONLY source of truth for a user's role. `users.role_id` has been
 * removed entirely (see migration `*-DropUsersRoleId.ts`); every consumer that used to read
 * `user.role`/`user.roleId` now goes through UserRoleService instead (see that service's own doc
 * comment for the full list of read paths, including the non-RBAC business ones).
 *
 * TODAY, every user has exactly one row here (one user : one role), matching current real
 * behavior exactly — this table was designed so a SECOND row can be added later for true multi-role
 * support without another schema change, not because multi-role is implemented now. Nothing in
 * this codebase currently assigns, reads, or merges more than one role per user.
 */
@Entity('user_roles')
@Index(['userId', 'roleId'], { unique: true })
export class UserRole extends BaseEntity {
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'user_id' })
  userId!: number;

  @ManyToOne(() => Role, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @Column({ name: 'role_id' })
  roleId!: number;
}
