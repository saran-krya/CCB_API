import {
  Column,
  Entity,
} from "typeorm";

import { BaseEntity } from "../../../common/entities/base.entity";

@Entity("business_roles")
export class BusinessRole extends BaseEntity {
  @Column({
    type: "varchar",
    length: 150,
    unique: true,
  })
  name!: string;

  @Column({
    type: "varchar",
    length: 500,
    nullable: true,
  })
  description?: string;

  @Column({
    type: "boolean",
    default: true,
  })
  active!: boolean;
}