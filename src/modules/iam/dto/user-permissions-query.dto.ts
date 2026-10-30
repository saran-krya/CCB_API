import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const USER_PERMISSION_KINDS = ['role', 'inline'] as const;
export type UserPermissionKind = (typeof USER_PERMISSION_KINDS)[number];

export const USER_PERMISSION_SORT_COLUMNS = ['name', 'type', 'attachedVia'] as const;
export type UserPermissionSortColumn = (typeof USER_PERMISSION_SORT_COLUMNS)[number];

export class UserPermissionsQueryDto {
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

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'ASC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: 'ASC' | 'DESC' = 'ASC';
}
