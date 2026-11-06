import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_PAGE, MIN_PAGE, SHORT_LIST_DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT } from '../../../common/constants/pagination.constants';
import { SORT_ORDER_VALUES, SORT_ORDER, SortOrder } from '../../../common/constants/sort.constants';

export const POLICY_ATTACHMENTS = ['attached', 'unattached'] as const;
export type PolicyAttachment = (typeof POLICY_ATTACHMENTS)[number];

export const POLICY_TYPES = ['system', 'custom'] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export const POLICY_LIST_SORT_COLUMNS = ['name', 'type', 'usedAs', 'description', 'createdAt'] as const;
export type PolicyListSortColumn = (typeof POLICY_LIST_SORT_COLUMNS)[number];

/** Query for the Policies list (GET /iam/policies/list) — also what the role forms' policy combobox searches. */
export class PolicyListQueryDto {
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

  @ApiPropertyOptional({ enum: POLICY_ATTACHMENTS, description: 'Only policies attached to a role, or only unattached ones' })
  @IsOptional()
  @IsIn(POLICY_ATTACHMENTS)
  attachment?: PolicyAttachment;

  @ApiPropertyOptional({ enum: POLICY_TYPES, description: 'System or custom only' })
  @IsOptional()
  @IsIn(POLICY_TYPES)
  type?: PolicyType;

  @ApiPropertyOptional({ description: 'Comma-separated policy ids to leave out (e.g. the ones a role already has)' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((v) => Number(v.trim())).filter((n) => Number.isInteger(n) && n > 0) : value,
  )
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @IsOptional()
  excludeIds?: number[];

  @ApiPropertyOptional({ enum: POLICY_LIST_SORT_COLUMNS, default: 'name' })
  @IsOptional()
  @IsIn(POLICY_LIST_SORT_COLUMNS)
  sortBy: PolicyListSortColumn = 'name';

  @ApiPropertyOptional({ enum: SORT_ORDER_VALUES, default: SORT_ORDER.ASC })
  @IsOptional()
  @IsIn(SORT_ORDER_VALUES)
  sortOrder: SortOrder = SORT_ORDER.ASC;
}
