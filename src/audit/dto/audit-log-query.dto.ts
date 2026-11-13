import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { BasePaginationDto } from '../../common/dto/base-pagination.dto';

export const AUDIT_LOG_SORT_COLUMNS = ['createdAt', 'moduleName', 'action'] as const;
export type AuditLogSortColumn = (typeof AUDIT_LOG_SORT_COLUMNS)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Filters of GET /audit-logs. Every filter is optional and they combine with AND; `search` matches every word against the
 *  action, the module and the actor's name or email. */
export class AuditLogQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ enum: AUDIT_LOG_SORT_COLUMNS, default: 'createdAt' })
  @IsOptional()
  @IsIn(AUDIT_LOG_SORT_COLUMNS)
  sortBy?: AuditLogSortColumn;

  @ApiPropertyOptional({ description: 'Exact stored module name, as listed in meta.modules' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  moduleName?: string;

  @ApiPropertyOptional({ description: 'Exact stored action, as listed in meta.actions' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ description: 'Id of the staff user who performed the action', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  performedBy?: number;

  @ApiPropertyOptional({ description: 'Id of the affected record (use together with moduleName)', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  entityId?: number;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'First day included (YYYY-MM-DD, server time zone)' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'dateFrom must be a date in YYYY-MM-DD format' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-11-10', description: 'Last day included (YYYY-MM-DD, server time zone)' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'dateTo must be a date in YYYY-MM-DD format' })
  dateTo?: string;
}
