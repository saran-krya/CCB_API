
export enum ImportFailureReason {
  MISSING_REQUIRED = 'missing_required',
  NOT_FOUND = 'not_found',
  MISMATCH = 'mismatch',
  DUPLICATE = 'duplicate',
  OTHER = 'other',
}

export interface ImportFailedRecord {
  rowNumber: number;
  reason: string;
  reasonType: ImportFailureReason;
  values: Record<string, string | null>;
}

export interface ImportSummary {
  batchId: string;
  fileName: string;
  importType: string;
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  skippedRows: number;
  duplicateRows: number;
  warnings: number;
  durationMs: number;
  importedIds: number[];
  importedCodes: string[];
  failedRecords: ImportFailedRecord[];
}
