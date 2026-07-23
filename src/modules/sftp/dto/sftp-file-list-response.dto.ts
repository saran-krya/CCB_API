import { SftpIngestionLog } from '../entities/sftp-ingestion-log.entity';
import { PaginatedResult } from '../../../common/interfaces/paginated-result.interface';

// Same snake_case exception as estate-summary-response.dto.ts (see that
// file's own comment) — this module's Dashboard-facing responses are
// snake_case by explicit spec requirement, unlike the rest of this
// codebase's default camelCase JSON.

export interface SftpFileListItemDto {
  id: number;
  file_name: string | null;
  file_status: string;
  dtu: string | null;
  community: string | null;
  property: string | null;
  file_size_bytes: number | null;
  received_meter_count: number;
  valid_reading_count: number;
  anomaly_count: number;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  processing_duration_ms: number | null;
  moved_to_folder: string | null;
  error_message: string | null;
}

export interface SftpFileListResponseDto {
  items: SftpFileListItemDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// Per-file Community/Property computed dynamically from the readings a file
// actually produced (see SftpFileListService.resolveFileLocations) — never
// persisted, always recomputed at read time from meter_readings + the
// existing meter/property/community tables. `null` means no meter_reading
// resolved to a known meter (nothing to show); the literal string
// "Multiple" means the file's readings span more than one property/
// community.
export interface ResolvedFileLocation {
  property: string | null;
  community: string | null;
}

export function toSftpFileListItemDto(
  log: SftpIngestionLog,
  resolved?: Map<number, ResolvedFileLocation>,
): SftpFileListItemDto {
  const fallback = resolved?.get(log.id);
  return {
    id: log.id,
    file_name: log.fileName ?? null,
    file_status: log.fileStatus,
    dtu: log.dtu ?? null,
    community: log.community?.name ?? fallback?.community ?? null,
    property: log.property?.name ?? fallback?.property ?? null,
    file_size_bytes: log.fileSizeBytes ?? null,
    received_meter_count: log.receivedMeterCount,
    valid_reading_count: log.validReadingCount,
    anomaly_count: log.anomalyCount,
    processing_started_at: log.processingStartedAt?.toISOString() ?? null,
    processing_completed_at: log.processingCompletedAt?.toISOString() ?? null,
    processing_duration_ms: log.processingDurationMs ?? null,
    moved_to_folder: log.movedToFolder ?? null,
    error_message: log.errorMessage ?? null,
  };
}

export function toSftpFileListResponseDto(
  result: PaginatedResult<SftpIngestionLog>,
  resolved?: Map<number, ResolvedFileLocation>,
): SftpFileListResponseDto {
  return {
    items: result.items.map((item) => toSftpFileListItemDto(item, resolved)),
    pagination: {
      page: result.pagination.page,
      limit: result.pagination.limit,
      total: result.pagination.total,
      total_pages: result.pagination.totalPages,
    },
  };
}

export interface SftpFileFilterMetadataDto {
  communities: { id: number; name: string }[];
  statuses: { value: string; label: string }[];
}
