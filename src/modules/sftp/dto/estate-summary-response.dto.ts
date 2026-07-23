import { SftpEstateSummary } from '../entities/sftp-estate-summary.entity';
import { SftpIngestionLog } from '../entities/sftp-ingestion-log.entity';

// Every Dashboard-facing response in this module is snake_case, by explicit
// spec requirement — a deliberate one-module exception to the rest of this
// codebase's camelCase JSON convention (every other controller returns its
// entities/DTOs as-is). These mapping functions are the ONLY place that
// snake_case translation happens; nothing upstream (the entities, the
// service) is snake_case internally.

export interface MissingDtuDto {
  dtu: string;
  community: string | null;
  property: string | null;
  expected_meter_count: number | null;
}

export interface FailedDtuDto {
  dtu: string | null;
  file_name: string | null;
  error_message: string | null;
}

export interface SummaryResponseDto {
  date: string;
  ingestion_status: string;
  ingestion_completed_at: string | null;
  files: {
    expected: number;
    received: number;
    missing: number;
    failed: number;
    duplicate: number;
  };
  readings: {
    meters_expected: number;
    meters_received: number;
    valid_readings: number;
    anomaly_count: number;
  };
  anomalies_by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  data_quality_pct: number;
  active_meters: number;
  missing_dtus: MissingDtuDto[];
  failed_dtus: FailedDtuDto[];
}

export function toSummaryResponseDto(
  summary: SftpEstateSummary,
  missingLogs: SftpIngestionLog[],
  failedLogs: SftpIngestionLog[],
): SummaryResponseDto {
  return {
    date: summary.summaryDate,
    ingestion_status: summary.ingestionStatus,
    ingestion_completed_at: summary.ingestionCompletedAt?.toISOString() ?? null,
    files: {
      expected: summary.filesExpected,
      received: summary.filesReceived,
      missing: summary.filesMissing,
      failed: summary.filesFailed,
      duplicate: summary.filesDuplicate,
    },
    readings: {
      meters_expected: summary.metersExpected,
      meters_received: summary.metersReceived,
      valid_readings: summary.validReadings,
      anomaly_count: summary.anomalyCount,
    },
    anomalies_by_severity: {
      critical: summary.criticalAnomalyCount,
      high: summary.highAnomalyCount,
      medium: summary.mediumAnomalyCount,
      low: summary.lowAnomalyCount,
    },
    data_quality_pct: Number(summary.dataQualityPct),
    active_meters: summary.activeMeters,
    missing_dtus: missingLogs.map(toMissingDtuDto),
    failed_dtus: failedLogs.map(toFailedDtuDto),
  };
}

export function toMissingDtuDto(log: SftpIngestionLog): MissingDtuDto {
  return {
    dtu: log.dtu ?? '',
    community: log.community?.name ?? null,
    property: log.property?.name ?? null,
    expected_meter_count: log.expectedMeterCount ?? null,
  };
}

export function toFailedDtuDto(log: SftpIngestionLog): FailedDtuDto {
  return {
    dtu: log.dtu ?? null,
    file_name: log.fileName ?? null,
    error_message: log.errorMessage ?? null,
  };
}

export interface TrendPointDto {
  date: string;
  data_quality_pct?: number;
  files_received?: number;
  anomaly_count?: number;
}

export type TrendMetric = 'all' | 'data_quality' | 'files_received' | 'anomaly_count';

export function toTrendPointDto(summary: SftpEstateSummary, metric: TrendMetric): TrendPointDto {
  const point: TrendPointDto = { date: summary.summaryDate };
  if (metric === 'all' || metric === 'data_quality') {
    point.data_quality_pct = Number(summary.dataQualityPct);
  }
  if (metric === 'all' || metric === 'files_received') {
    point.files_received = summary.filesReceived;
  }
  if (metric === 'all' || metric === 'anomaly_count') {
    point.anomaly_count = summary.anomalyCount;
  }
  return point;
}

export interface HealthResponseDto {
  last_ingestion_date: string | null;
  last_ingestion_status: string | null;
  last_ingestion_completed_at: string | null;
  files_expected: number;
  files_received: number;
  next_scheduled_poll: string;
}

export interface MissingFilesResponseDto {
  missing_count: number;
  failed_count: number;
  missing_files: MissingDtuDto[];
  failed_files: FailedDtuDto[];
}
