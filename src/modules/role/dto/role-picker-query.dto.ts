import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const ROLE_PICKER_SORT_COLUMNS = ['name', 'type', 'users'] as const;
export type RolePickerSortColumn = (typeof ROLE_PICKER_SORT_COLUMNS)[number];

/** Query for the Roles picker on Create / Edit User (GET /roles/picker). */
export class RolePickerQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
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

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'ASC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: 'ASC' | 'DESC' = 'ASC';
}
