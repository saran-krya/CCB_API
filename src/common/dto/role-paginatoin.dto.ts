import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class RoleQueryDto {
  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 20;

  @ApiPropertyOptional({
    description: "Search by role name",
  })
  @IsOptional()
  @IsString()
  ["search.roleName"]?: string;

  @ApiPropertyOptional({
    description: "Filter by user category ID",
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  userCategoryId?: number;

  @ApiPropertyOptional({
    description: "Filter by user type ID",
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  userTypeId?: number;

  @ApiPropertyOptional({
    description: "Search by created date (YYYY-MM-DD)",
    example: "2026-06-25",
  })
  @IsOptional()
  @IsString()
  ["search.createdAt"]?: string;

  @ApiPropertyOptional({
    example: "createdAt",
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({
    enum: ["ASC", "DESC"],
    default: "DESC",
  })
  @IsOptional()
  @IsIn(["ASC", "DESC"])
  sortOrder: "ASC" | "DESC" = "DESC";
}