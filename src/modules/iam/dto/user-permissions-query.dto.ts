import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_PAGE, MIN_PAGE, SHORT_LIST_DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT } from '../../../common/constants/pagination.constants';
import { SORT_ORDER_VALUES, SORT_ORDER, SortOrder } from '../../../common/constants/sort.constants';

export const USER_PERMISSION_KINDS = ['role', 'inline'] as const;
export type UserPermissionKind = (typeof USER_PERMISSION_KINDS)[number];

export const USER_PERMISSION_SORT_COLUMNS = ['name', 'type', 'attachedVia'] as const;
export type UserPermissionSortColumn = (typeof USER_PERMISSION_SORT_COLUMNS)[number];

export class UserPermissionsQueryDto {
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

  @ApiPropertyOptional({ description: 'Matches the name, type, how it is attached, or (roles) the user category' })
  @IsOptional()
  @IsString()
  ['search.query']?: string;

  @ApiPropertyOptional({ enum: USER_PERMISSION_KINDS, description: 'Only roles, or only inline policies' })
  @IsOptional()
  @IsIn(USER_PERMISSION_KINDS)
  type?: UserPermissionKind;

  @ApiPropertyOptional({ enum: USER_PERMISSION_SORT_COLUMNS, default: 'name' })
  @IsOptional()
  @IsIn(USER_PERMISSION_SORT_COLUMNS)
  sortBy: UserPermissionSortColumn = 'name';

  @ApiPropertyOptional({ enum: SORT_ORDER_VALUES, default: SORT_ORDER.ASC })
  @IsOptional()
  @IsIn(SORT_ORDER_VALUES)
  sortOrder: SortOrder = SORT_ORDER.ASC;
}
