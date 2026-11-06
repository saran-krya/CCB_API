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
import { DEFAULT_PAGE, MIN_PAGE, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT } from '../constants/pagination.constants';
import { SORT_ORDER_VALUES, SORT_ORDER, SortOrder } from '../constants/sort.constants';

export const ROLE_LIST_SORT_COLUMNS = [
  "roleName",
  "userCategory",
  "assignedUserCount",
  "policyCount",
  "createdAt",
] as const;
export type RoleListSortColumn = (typeof ROLE_LIST_SORT_COLUMNS)[number];

export class RoleQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_PAGE,
    minimum: MIN_PAGE,
  })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_PAGE)
  @IsOptional()
  page = DEFAULT_PAGE;

  @ApiPropertyOptional({
    default: DEFAULT_LIMIT,
    minimum: MIN_LIMIT,
    maximum: MAX_LIMIT,
  })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_LIMIT)
  @Max(MAX_LIMIT)
  @IsOptional()
  limit = DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description: "Matches the role name, its description or its user category",
  })
  @IsOptional()
  @IsString()
  ["search.query"]?: string;

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
    description: "Search by created date (YYYY-MM-DD)",
    example: "2026-06-25",
  })
  @IsOptional()
  @IsString()
  ["search.createdAt"]?: string;

  @ApiPropertyOptional({
    enum: ROLE_LIST_SORT_COLUMNS,
    default: "createdAt",
  })
  @IsOptional()
  @IsIn(ROLE_LIST_SORT_COLUMNS)
  sortBy?: RoleListSortColumn;

  @ApiPropertyOptional({
    enum: SORT_ORDER_VALUES,
    default: SORT_ORDER.DESC,
  })
  @IsOptional()
  @IsIn(SORT_ORDER_VALUES)
  sortOrder: SortOrder = SORT_ORDER.DESC;
}
