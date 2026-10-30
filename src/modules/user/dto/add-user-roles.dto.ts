import { ApiProperty } from "@nestjs/swagger";

import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  Min,
} from "class-validator";

export class AddUserRolesDto {
  @ApiProperty({
    type: [Number],
    example: [2, 5],
    description:
      "Roles to add to the user — at least one, no duplicates. Roles the user already holds are skipped; nothing is ever removed.",
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  roleIds!: number[];
}
