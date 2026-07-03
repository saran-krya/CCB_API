import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { BaseEntity } from "../../../common/entities/base.entity";
import { Role } from "../../role/entities/role.entity";
import { BusinessRole } from "../../business-role/entities/business-role.entity";

@Entity("users")
export class User extends BaseEntity {
  @ManyToOne(
    () => Role,
    (role) => role.users,
    {
      eager: true,
      nullable: true,
    },
  )
  @JoinColumn({
    name: "role_id",
  })
  role!: Role;

  @ManyToOne(
    () => BusinessRole,
    {
      eager: true,
      nullable: true,
    },
  )
  @JoinColumn({
    name: "business_role_id",
  })
  businessRole?: BusinessRole;

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

}