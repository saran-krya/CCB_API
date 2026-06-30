import {
  ApiProperty,
  PartialType,
} from "@nestjs/swagger";

import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateBusinessRoleDto {
  @ApiProperty({
    example: "Finance Manager",
  })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    example:
      "Finance department manager",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    default: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateBusinessRoleDto extends PartialType(
  CreateBusinessRoleDto,
) {}