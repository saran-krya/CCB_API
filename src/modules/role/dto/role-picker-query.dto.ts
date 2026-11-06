import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_PAGE, MIN_PAGE, MIN_LIMIT, MAX_LIMIT } from '../../../common/constants/pagination.constants';
import { SORT_ORDER_VALUES, SORT_ORDER, SortOrder } from '../../../common/constants/sort.constants';

export const ROLE_PICKER_SORT_COLUMNS = ['name', 'type', 'users'] as const;
export type RolePickerSortColumn = (typeof ROLE_PICKER_SORT_COLUMNS)[number];

/** Query for the Roles picker on Create / Edit User (GET /roles/picker). */
export class RolePickerQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_PAGE, minimum: MIN_PAGE })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_PAGE)
  @IsOptional()
  page = DEFAULT_PAGE;

  @ApiPropertyOptional({ default: 5, minimum: MIN_LIMIT, maximum: MAX_LIMIT })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_LIMIT)
  @Max(MAX_LIMIT)
  @IsOptional()
  limit = 5;

  @ApiPropertyOptional({ description: 'Matches the role name, its description or its user category' })
  @IsOptional()
  @IsString()
  ['search.query']?: string;

  @ApiPropertyOptional({ description: 'Only roles of this user category' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  userCategoryId?: number;

  @ApiPropertyOptional({ enum: ROLE_PICKER_SORT_COLUMNS, default: 'name' })
  @IsOptional()
  @IsIn(ROLE_PICKER_SORT_COLUMNS)
  sortBy: RolePickerSortColumn = 'name';

  @ApiPropertyOptional({ enum: SORT_ORDER_VALUES, default: SORT_ORDER.ASC })
  @IsOptional()
  @IsIn(SORT_ORDER_VALUES)
  sortOrder: SortOrder = SORT_ORDER.ASC;
}
