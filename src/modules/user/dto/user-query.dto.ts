import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { DEFAULT_PAGE, MIN_PAGE, SHORT_LIST_DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT } from '../../../common/constants/pagination.constants';
import { SORT_ORDER_VALUES, SORT_ORDER, SortOrder } from '../../../common/constants/sort.constants';

// Own DTO (same pattern as RoleQueryDto) rather than the shared PaginationQueryDto's separate
// search.fullName/search.email/search.mobile/search.role fields — the Users list page now has ONE
// search box (matching Role Management's own single-search layout) that must match a name, email,
// mobile number OR role name, not four independent AND'd filters.
export class UserQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_PAGE, minimum: MIN_PAGE })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_PAGE)
  @IsOptional()
  page = DEFAULT_PAGE;

  @ApiPropertyOptional({ default: SHORT_LIST_DEFAULT_LIMIT, minimum: MIN_LIMIT, maximum: MAX_LIMIT })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_LIMIT)
  @Max(MAX_LIMIT)
  @IsOptional()
  limit = SHORT_LIST_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description: "Matches against full name, email, mobile number, or role name",
  })
  @IsOptional()
  @IsString()
  ["search.query"]?: string;

  @ApiPropertyOptional({ enum: ["active", "inactive"], description: "Only active or only inactive users" })
  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";

  @ApiPropertyOptional({ description: "Only users who currently hold this role" })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  roleId?: number;

  @ApiPropertyOptional({ example: "createdAt" })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: SORT_ORDER_VALUES, default: SORT_ORDER.DESC })
  @IsOptional()
  @IsIn(SORT_ORDER_VALUES)
  sortOrder: SortOrder = SORT_ORDER.DESC;
}
