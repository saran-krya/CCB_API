import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { SftpIngestionStatus } from '../entities/sftp-ingestion-status.enum';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Query params for GET /sftp/files — one row per SftpIngestionLog entry,
// covering EVERY file_status (Processed/Duplicate/Missing/Failed), unlike
// /missing-files (Missing/Failed only) or /summary (date-level aggregates
// only). This is the only endpoint that lets the Files List UI show a
// successfully-processed file at all.
export class SftpFileQueryDto extends BasePaginationDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  override limit = 20;

  @ApiPropertyOptional({ enum: SftpIngestionStatus, description: 'Filter to one file_status' })
  @IsOptional()
  @IsEnum(SftpIngestionStatus)
  status?: SftpIngestionStatus;

  @ApiPropertyOptional({ description: 'Community id — exact match' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  communityId?: number;

  @ApiPropertyOptional({ description: 'Property name substring search' })
  @IsOptional()
  @IsString()
  property?: string;

  @ApiPropertyOptional({ example: '2026-07-20', description: 'Calendar date (reading_date for Missing rows, created_at date otherwise) — defaults to no date filter (all dates)' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'date must be a YYYY-MM-DD date' })
  date?: string;
}
