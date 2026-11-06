import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_PAGE, MIN_PAGE, SHORT_LIST_DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT } from '../../../common/constants/pagination.constants';
import { SORT_ORDER_VALUES, SORT_ORDER, SortOrder } from '../../../common/constants/sort.constants';

export const POLICY_ATTACHED_ROLE_SORT_COLUMNS = ['roleName', 'userCategory'] as const;
export type PolicyAttachedRoleSortColumn = (typeof POLICY_ATTACHED_ROLE_SORT_COLUMNS)[number];

/** Query for the roles one policy is attached to (GET /iam/policies/:id/roles/list) and, identically, the roles it is
 *  not attached to (GET /iam/policies/:id/roles/available/list). */
export class PolicyAttachedRolesQueryDto {
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

  @ApiPropertyOptional({ description: 'Matches the role name' })
  @IsOptional()
  @IsString()
  ['search.query']?: string;

  @ApiPropertyOptional({ description: 'Only roles of this user category' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  userCategoryId?: number;

  @ApiPropertyOptional({ enum: POLICY_ATTACHED_ROLE_SORT_COLUMNS, default: 'roleName' })
  @IsOptional()
  @IsIn(POLICY_ATTACHED_ROLE_SORT_COLUMNS)
  sortBy: PolicyAttachedRoleSortColumn = 'roleName';

  @ApiPropertyOptional({ enum: SORT_ORDER_VALUES, default: SORT_ORDER.ASC })
  @IsOptional()
  @IsIn(SORT_ORDER_VALUES)
  sortOrder: SortOrder = SORT_ORDER.ASC;
}
