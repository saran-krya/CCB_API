import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const ROLE_POLICY_TYPES = ['system', 'custom'] as const;
export type RolePolicyType = (typeof ROLE_POLICY_TYPES)[number];

export const ROLE_POLICY_SORT_COLUMNS = ['name', 'type', 'attachedEntities'] as const;
export type RolePolicySortColumn = (typeof ROLE_POLICY_SORT_COLUMNS)[number];

/** Query for the policies attached to one role (GET /roles/:roleId/policies/list). */
export class RolePoliciesQueryDto {
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

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'ASC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: 'ASC' | 'DESC' = 'ASC';
}
