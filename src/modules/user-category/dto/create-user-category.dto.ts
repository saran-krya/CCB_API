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

export class CreateUserCategoryDto {
  @ApiProperty({
    example: "Internal",
  })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    required: false,
    example: "Internal Employee",
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

export class UpdateUserCategoryDto extends PartialType(
  CreateUserCategoryDto,
) {}