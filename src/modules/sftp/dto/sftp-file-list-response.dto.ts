import { SftpIngestionLog } from '../entities/sftp-ingestion-log.entity';
import { PaginatedResult } from '../../../common/interfaces/paginated-result.interface';

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
