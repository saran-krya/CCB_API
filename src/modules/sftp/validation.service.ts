import { Injectable } from '@nestjs/common';
import { stat } from 'fs/promises';
import { extname } from 'path';


const REQUIRED_HEADERS = ['meter_id', 'reading_date', 'reading_value', 'unit'] as const;


export enum AnomalySeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

const SEVERITY_RANK: Record<AnomalySeverity, number> = {
  [AnomalySeverity.CRITICAL]: 4,
  [AnomalySeverity.HIGH]: 3,
  [AnomalySeverity.MEDIUM]: 2,
  [AnomalySeverity.LOW]: 1,
};

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

export interface RowValidationError {
  row: number;
  field: string;
  message: string;
  severity: AnomalySeverity;
}

export interface RowValidationResult {
  valid: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: RowValidationError[];

  severityCounts: Record<AnomalySeverity, number>;
}

@Injectable()
export class ValidationService {
  async validateFile(localFilePath: string, rows: Record<string, string>[]): Promise<FileValidationResult> {
    const errors: string[] = [];

    if (extname(localFilePath).toLowerCase() !== '.csv') {
      errors.push(`File "${localFilePath}" does not have a .csv extension`);
    }

    let isEmpty = false;
    try {
      const { size } = await stat(localFilePath);
      isEmpty = size === 0;
    } catch {
      errors.push(`File "${localFilePath}" could not be read`);
    }
    if (isEmpty) {
      errors.push('File is empty');
    }

    if (rows.length === 0) {
      errors.push('CSV contains no data rows');
    } else {

      const presentHeaders = new Set(Object.keys(rows[0]));
      const missingHeaders = REQUIRED_HEADERS.filter((header) => !presentHeaders.has(header));
      if (missingHeaders.length > 0) {
        errors.push(`Missing required header(s): ${missingHeaders.join(', ')}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async validateRows(rows: Record<string, string>[]): Promise<RowValidationResult> {
    const errors: RowValidationError[] = [];

    rows.forEach((row, index) => {

      const rowNumber = index + 1;

      const meterId = row.meter_id?.trim();
      if (!meterId) {
        errors.push({ row: rowNumber, field: 'meter_id', message: 'meter_id is required', severity: AnomalySeverity.CRITICAL });
      }

      const readingDate = row.reading_date?.trim();
      if (!readingDate) {
        errors.push({ row: rowNumber, field: 'reading_date', message: 'reading_date is required', severity: AnomalySeverity.LOW });
      }

      const readingValueRaw = row.reading_value?.trim();
      if (!readingValueRaw) {
        errors.push({ row: rowNumber, field: 'reading_value', message: 'reading_value is required', severity: AnomalySeverity.HIGH });
      } else {
        const readingValue = Number(readingValueRaw);
        if (Number.isNaN(readingValue)) {
          errors.push({ row: rowNumber, field: 'reading_value', message: 'reading_value must be numeric', severity: AnomalySeverity.HIGH });
        } else if (readingValue < 0) {
          errors.push({ row: rowNumber, field: 'reading_value', message: 'Value cannot be negative', severity: AnomalySeverity.MEDIUM });
        }
      }

      const unit = row.unit?.trim();
      if (!unit) {
        errors.push({ row: rowNumber, field: 'unit', message: 'unit is required', severity: AnomalySeverity.LOW });
      }
    });

    const invalidRowNumbers = new Set(errors.map((e) => e.row));
    const invalidRows = invalidRowNumbers.size;
    const totalRows = rows.length;

    return {
      valid: errors.length === 0,
      totalRows,
      validRows: totalRows - invalidRows,
      invalidRows,
      errors,
      severityCounts: this.worstSeverityPerRow(errors),
    };
  }

  
  private worstSeverityPerRow(errors: RowValidationError[]): Record<AnomalySeverity, number> {
    const worstByRow = new Map<number, AnomalySeverity>();
    for (const error of errors) {
      const current = worstByRow.get(error.row);
      if (!current || SEVERITY_RANK[error.severity] > SEVERITY_RANK[current]) {
        worstByRow.set(error.row, error.severity);
      }
    }

    const counts: Record<AnomalySeverity, number> = {
      [AnomalySeverity.CRITICAL]: 0,
      [AnomalySeverity.HIGH]: 0,
      [AnomalySeverity.MEDIUM]: 0,
      [AnomalySeverity.LOW]: 0,
    };
    for (const severity of worstByRow.values()) {
      counts[severity] += 1;
    }
    return counts;
  }
}
