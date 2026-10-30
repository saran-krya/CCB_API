import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const POLICY_ATTACHED_ROLE_SORT_COLUMNS = ['roleName', 'userCategory'] as const;
export type PolicyAttachedRoleSortColumn = (typeof POLICY_ATTACHED_ROLE_SORT_COLUMNS)[number];

/** Query for the roles one policy is attached to (GET /iam/policies/:id/roles/list). */
export class PolicyAttachedRolesQueryDto {
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

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'ASC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: 'ASC' | 'DESC' = 'ASC';
}
