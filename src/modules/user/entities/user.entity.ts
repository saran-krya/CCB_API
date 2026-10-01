import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { BaseEntity } from "../../../common/entities/base.entity";

// A user's role is NOT a relation on this entity — see UserRoleService (user_roles is the only
// source of truth for User -> Role; `users.role_id` has been removed, see migration
// *-DropUsersRoleId.ts). Some query paths (UserService.findAll/findOne) still attach a `role`
// property to a loaded User instance at runtime via `leftJoinAndMapOne`/manual assignment for
// response-shape compatibility — that is NOT this entity's own column, just a query-time virtual.
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