import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

// Own DTO (same pattern as RoleQueryDto) rather than the shared PaginationQueryDto's separate
// search.fullName/search.email/search.mobile/search.role fields — the Users list page now has ONE
// search box (matching Role Management's own single-search layout) that must match a name, email,
// mobile number OR role name, not four independent AND'd filters.
export class UserQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 10;

  @ApiPropertyOptional({
    description: "Matches against full name, email, mobile number, or role name",
  })
  @IsOptional()
  @IsString()
  ["search.query"]?: string;

  @ApiPropertyOptional({ example: "createdAt" })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ["ASC", "DESC"], default: "DESC" })
  @IsOptional()
  @IsIn(["ASC", "DESC"])
  sortOrder: "ASC" | "DESC" = "DESC";
}
