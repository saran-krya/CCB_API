import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { BasePaginationDto } from '../../../common/dto/base-pagination.dto';
import { SftpIngestionStatus } from '../entities/sftp-ingestion-status.enum';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

  // Deliberately matches ONLY DATE(log.created_at) — the actual file upload/processing timestamp,
  // same value the Files table's own "Ingested" column already displays. A confirmed incident
  // showed the OLD single `date` param (reading_date OR created_at, unconditional) incorrectly
  // matched a file processed 2026-10-13 against a filter of 2026-09-28, because that file's
  // reading_date (parsed from its filename) happened to be 2026-09-28 — even though the file was
  // never actually uploaded/processed on that date. Never falls back to reading_date, even when
  // reading_date is null — this filter's only meaning is "when was this file processed."
  @ApiPropertyOptional({ example: '2026-10-13', description: 'File upload/processing date (matches created_at only, never reading_date) — defaults to no date filter (all dates)' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'sftpDate must be a YYYY-MM-DD date' })
  sftpDate?: string;

  // Deliberately SEPARATE from sftpDate above, not an OR/fallback of it — matches ONLY
  // log.reading_date, the meter-reading date parsed from the filename. A file can be processed on
  // one date and contain readings for an entirely different (usually earlier) date; these are two
  // independent questions a user may want to filter by independently, never conflated into one
  // param the way the old `date` field did.
  @ApiPropertyOptional({ example: '2026-09-28', description: 'Meter reading date parsed from the filename (matches reading_date only, never created_at) — defaults to no date filter (all dates)' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: 'readingDate must be a YYYY-MM-DD date' })
  readingDate?: string;
}
