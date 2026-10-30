import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { BaseEntity } from "../../../common/entities/base.entity";

// A user's roles are NOT a relation on this entity — see UserRoleService (user_roles is the only
// source of truth for User -> Role, one user to many roles; `users.role_id` has been removed, see
// migration *-DropUsersRoleId.ts). UserService.findOne/findAll attach `role` (the PRIMARY role — the
// first assigned) and `roles` (every role, in assignment order) to the User they return — query-time
// virtuals (see UserWithRoles), NOT this entity's own columns or relations.
@Entity("users")
export class User extends BaseEntity {
  @ManyToOne(
    () => User,
    {
      nullable: true,
    },
  )
  @JoinColumn({
    name: "reporting_manager_id",
  })
  reportingManager?: User;

  @Column({
    name: "first_name",
    type: "varchar",
    length: 100,
  })
  firstName!: string;

  @Column({
    name: "middle_name",
    type: "varchar",
    length: 100,
    nullable: true,
  })
  middleName?: string;

  @Column({
    name: "last_name",
    type: "varchar",
    length: 100,
  })
  lastName!: string;

  @Column({
    type: "varchar",
    length: 150,
    nullable: true,
  })
  designation?: string;

  @Column({
    type: "varchar",
    length: 160,
    unique: true,
  })
  email!: string;

  @Column({
    type: "varchar",
    length: 20,
    nullable: true,
    unique: true,
  })
  mobile?: string | null;

  @Index()
  @Column({
    type: "boolean",
    default: true,
  })
  active!: boolean;

  @Column({
    name: "last_login_at",
    type: "timestamp",
    nullable: true,
  })
  lastLoginAt?: Date | null;

  @Column({
    name: "employee_code",
    type: "varchar",
    length: 50,
    nullable: true,
    unique: true,
  })
  employeeCode?: string | null;

  @Column({
    name: "password_hash",
    type: "varchar",
    length: 255,
    nullable: true,
    select: false,
  })
  passwordHash?: string | null;

  // Set at creation time by the Create User wizard's "Users must create a new password at next
  // sign-in" checkbox — checked once by AuthService.login's staff branch (included in the login
  // response so the frontend can redirect to a mandatory change-password screen before letting them
  // into the app) and cleared by AuthService.changePassword once they actually change it.
  @Column({
    name: "must_change_password",
    type: "boolean",
    default: false,
  })
  mustChangePassword!: boolean;

  // When the current password_hash was last set (by any path — self-service change-password,
  // admin-triggered reset, or creation). NOT the same as BaseEntity's own `updatedAt`, which ticks
  // on ANY column change (a name edit would otherwise look like a password change) — this column
  // changes for password-related writes only. Null for a user created with no password at all.
  // Powers the Security Credentials tab's "Sign-in access password: Updated N days ago" display.
  @Column({
    name: "password_updated_at",
    type: "timestamp",
    nullable: true,
  })
  passwordUpdatedAt?: Date | null;

  @Column({
    name: "sso_provider",
    type: "varchar",
    length: 80,
    nullable: true,
  })
  ssoProvider?: string | null;

  @Column({
    name: "sso_subject",
    type: "varchar",
    length: 160,
    nullable: true,
  })
  ssoSubject?: string | null;

  @Column({
    name: "theme_mode",
    type: "varchar",
    length: 10,
    nullable: true,
  })
  themeMode?: string | null;

  @Column({
    name: "nav_theme",
    type: "varchar",
    length: 20,
    nullable: true,
  })
  navTheme?: string | null;

  @Column({
    name: "preferred_language_code",
    type: "varchar",
    length: 10,
    nullable: true,
  })
  preferredLanguageCode?: string | null;

}