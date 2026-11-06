import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_PAGE, MIN_PAGE, SHORT_LIST_DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT } from '../../../common/constants/pagination.constants';
import { SORT_ORDER_VALUES, SORT_ORDER, SortOrder } from '../../../common/constants/sort.constants';

export const ROLE_POLICY_TYPES = ['system', 'custom'] as const;
export type RolePolicyType = (typeof ROLE_POLICY_TYPES)[number];

export const ROLE_POLICY_SORT_COLUMNS = ['name', 'type', 'attachedEntities'] as const;
export type RolePolicySortColumn = (typeof ROLE_POLICY_SORT_COLUMNS)[number];

/** Query for the policies attached to one role (GET /roles/:roleId/policies/list). */
export class RolePoliciesQueryDto {
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

  @ApiPropertyOptional({ description: 'Matches the policy name or description' })
  @IsOptional()
  @IsString()
  ['search.query']?: string;

  @ApiPropertyOptional({ enum: ROLE_POLICY_TYPES, description: 'System or custom only' })
  @IsOptional()
  @IsIn(ROLE_POLICY_TYPES)
  type?: RolePolicyType;

  @ApiPropertyOptional({ enum: ROLE_POLICY_SORT_COLUMNS, default: 'name' })
  @IsOptional()
  @IsIn(ROLE_POLICY_SORT_COLUMNS)
  sortBy: RolePolicySortColumn = 'name';

  @ApiPropertyOptional({ enum: SORT_ORDER_VALUES, default: SORT_ORDER.ASC })
  @IsOptional()
  @IsIn(SORT_ORDER_VALUES)
  sortOrder: SortOrder = SORT_ORDER.ASC;
}
