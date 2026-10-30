import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { Role } from '../../role/entities/role.entity';

/**
 * The User -> Role assignment — the ONLY source of truth for which roles a user holds. `users.role_id`
 * has been removed entirely (see migration `*-DropUsersRoleId.ts`); every consumer that used to read
 * `user.role`/`user.roleId` goes through UserRoleService instead (see that service's own doc comment
 * for the full list of read paths, including the non-RBAC business ones).
 *
 * A user holds ONE OR MORE roles: one row per (user, role), kept unique by the index below. `id ASC`
 * is assignment order, and the first row is the user's PRIMARY role — a compatibility/display notion
 * only (the signed JWT payload's roleId/roleName, the legacy singular `role` fields). Authorization
 * never stops at the primary: it takes the union over every row.
 *
 * Rows are only ever HARD-deleted. The unique key does not include `deleted_at`, so a soft-deleted row
 * would keep its (user_id, role_id) pair occupied and make re-granting that role fail.
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
