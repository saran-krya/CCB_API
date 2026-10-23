import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';
import { mkdir, readFile, stat } from 'fs/promises';
import { extname, join } from 'path';
import SftpClient = require('ssh2-sftp-client');
import csvParser = require('csv-parser');
import * as ExcelJS from 'exceljs';

const LOCAL_DOWNLOAD_DIR = join(process.cwd(), 'storage', 'sftp', 'temp');

// Both formats accepted for meter-reading files — CSV was the original/only format; .xlsx support
// was added so a file saved directly from Excel (not explicitly exported as CSV) still ingests
// correctly, since `.xlsx` renamed to `.csv` is NOT a valid CSV file and would otherwise silently
// fail parsing. Checked everywhere an extension gate exists (SftpService.parseFile,
// ValidationService.validateFile, SftpCronService's own folder-scan filter) — all three must agree
// on this same accepted-extensions list, or a file could pass one gate and fail a later one.
export const ACCEPTED_READING_FILE_EXTENSIONS = ['.csv', '.xlsx'] as const;

// csv-parser (v3.2.1) does not strip a UTF-8 BOM, so a BOM-prefixed source file (e.g. Excel's
// "CSV UTF-8" export) yields a first header key like "﻿meter_id" instead of "meter_id",
// silently failing REQUIRED_HEADERS checks downstream even though the file looks correct.
function stripBomFromKeys(row: Record<string, string>): Record<string, string> {
  const firstKey = Object.keys(row)[0];
  if (firstKey === undefined || !firstKey.startsWith('﻿')) return row;
  const { [firstKey]: value, ...rest } = row;
  return { [firstKey.slice(1)]: value, ...rest };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// A cell Excel stores as a real date comes back from ExcelJS's `.value` as a native JS `Date` —
// format it as a plain ISO `YYYY-MM-DD` using LOCAL date parts (not `.toISOString()`, which
// converts to UTC first and can shift the date backward a day for any timezone behind UTC, e.g.
// the exact off-by-one this codebase would hit for a reading typed as "9/28/2026" in a UAE-local
// Excel file — this must read back as 2026-09-28, never 2026-09-27). Every other value falls back
// to ExcelJS's own `.text` formatted-display accessor, same as before.
function cellToString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  return cell.text ?? '';
}

@Injectable()
export class SftpService {
  private readonly logger = new Logger(SftpService.name);

  constructor(private readonly config: ConfigService) {}

  private createClient(): SftpClient {
    return new SftpClient();
  }

  async connect(): Promise<SftpClient> {
    const client = this.createClient();
    const host = this.config.getOrThrow<string>('SFTP_HOST');
    const port = Number(this.config.get<string>('SFTP_PORT', '22'));
    const username = this.config.getOrThrow<string>('SFTP_USERNAME');
    const password = this.config.getOrThrow<string>('SFTP_PASSWORD');

    try {
      await client.connect({ host, port, username, password });
      this.logger.log(`Connected to SFTP server ${host}:${port} as ${username}`);
      return client;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`SFTP connection to ${host}:${port} failed: ${message}`);
      throw new InternalServerErrorException('Failed to connect to the SFTP server');
    }
  }

  async disconnect(client: SftpClient): Promise<void> {
    try {
      await client.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`SFTP disconnect encountered an issue: ${message}`);
    }
  }

  async listFiles(): Promise<SftpClient.FileInfo[]> {
    const remotePath = this.config.getOrThrow<string>('SFTP_REMOTE_PATH');
    const client = await this.connect();
    try {
      const files = await client.list(remotePath);
      this.logger.log(`Listed ${files.length} entr${files.length === 1 ? 'y' : 'ies'} from ${remotePath}`);
      return files;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to list files at ${remotePath}: ${message}`);
      throw new InternalServerErrorException('Failed to list files on the SFTP server');
    } finally {
      await this.disconnect(client);
    }
  }

  async downloadFile(fileName: string): Promise<{ fileName: string; localPath: string; size: number }> {
    const remotePath = this.config.getOrThrow<string>('SFTP_REMOTE_PATH');
    const remoteFilePath = `${remotePath.replace(/\/+$/, '')}/${fileName}`;
    const localPath = join(LOCAL_DOWNLOAD_DIR, fileName);

    const client = await this.connect();
    try {
      const files = await client.list(remotePath);
      const remoteFile = files.find((f) => f.name === fileName);
      if (!remoteFile) {
        this.logger.warn(`Requested file "${fileName}" not found in ${remotePath}`);
        throw new NotFoundException(`File "${fileName}" was not found on the SFTP server`);
      }

      await mkdir(LOCAL_DOWNLOAD_DIR, { recursive: true });
      await client.fastGet(remoteFilePath, localPath);

      const { size } = await stat(localPath);
      this.logger.log(`Downloaded ${fileName} (${size} bytes) to ${localPath}`);
      return { fileName, localPath, size };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to download "${fileName}" from ${remotePath}: ${message}`);
      throw new InternalServerErrorException('Failed to download the file from the SFTP server');
    } finally {
      await this.disconnect(client);
    }
  }

  /** Parses a meter-reading file into the same `Record<string,string>[]` row shape regardless of
   *  source format — every downstream consumer (ValidationService.validateFile/validateRows,
   *  IngestionService) reads `row.meter_id`/`row.reading_date`/`row.reading_value`/`row.unit` as
   *  plain strings and never needs to know which format produced them. Dispatches purely on
   *  extension; `parseCsv`/`parseXlsx` remain as separate methods (not merged into one body) since
   *  their actual parsing mechanics — a streaming line-parser vs. a whole-workbook load — are
   *  different enough that a shared implementation would just be an if/else wrapped around two
   *  unrelated libraries anyway. */
  async parseFile(localFilePath: string): Promise<{ fileName: string; rowCount: number; rows: Record<string, string>[] }> {
    const ext = extname(localFilePath).toLowerCase();
    if (ext === '.xlsx') return this.parseXlsx(localFilePath);
    return this.parseCsv(localFilePath);
  }

  async parseCsv(localFilePath: string): Promise<{ fileName: string; rowCount: number; rows: Record<string, string>[] }> {
    const fileName = localFilePath.split(/[/\\]/).pop() ?? localFilePath;

    if (extname(localFilePath).toLowerCase() !== '.csv') {
      throw new BadRequestException(`"${fileName}" is not a .csv file`);
    }

    try {
      await stat(localFilePath);
    } catch {
      throw new NotFoundException(`File "${fileName}" was not found at ${localFilePath}`);
    }

    try {
      const rows = await new Promise<Record<string, string>[]>((resolve, reject) => {
        const collected: Record<string, string>[] = [];
        createReadStream(localFilePath)
          .on('error', (err) => reject(err))
          .pipe(csvParser())
          .on('data', (row: Record<string, string>) => collected.push(stripBomFromKeys(row)))
          .on('end', () => resolve(collected))
          .on('error', (err: Error) => reject(err));
      });
      this.logger.log(`Parsed ${rows.length} row${rows.length === 1 ? '' : 's'} from ${fileName}`);
      return { fileName, rowCount: rows.length, rows };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to parse CSV "${fileName}": ${message}`);
      throw new InternalServerErrorException('Failed to parse the CSV file');
    }
  }

  /** Reads the FIRST worksheet only — a meter-reading file is a single flat table, not a
   *  multi-sheet workbook, same assumption CSV already makes (one file, one table). Header row is
   *  row 1, matched by exact cell text (trimmed) rather than column position, so column order in
   *  the spreadsheet doesn't matter — same contract CSV's header-keyed `csv-parser` output already
   *  gives every downstream consumer.
   *
   *  Cell-to-string conversion is deliberately NOT just `cell.text` for every cell — a cell Excel
   *  stores as a real date (anything typed/formatted as a date, which is exactly what happens if a
   *  user types e.g. "9/28/2026" into the reading_date column instead of entering it as plain text)
   *  comes back from ExcelJS as a native JS `Date` object, and `cell.text` renders that as a full
   *  locale-formatted string like "Mon Sep 28 2026 05:30:00 GMT+0530 (India Standard Time)" — not
   *  the plain "2026-09-28" a CSV's text column would have had, and MySQL's `date` column rejects
   *  that string outright at insert time (ingestion.service.ts reads `row.reading_date` as a raw
   *  string with no reformatting). `cellToString` below special-cases a `Date` value and formats it
   *  as ISO `YYYY-MM-DD` instead, so a reading_date cell produces the exact same shape regardless of
   *  whether the uploader typed it as text or let Excel auto-detect it as a date. Every other cell
   *  type still uses `cell.text` (ExcelJS's own "formatted display value" accessor), so a numeric
   *  reading_value cell still comes out as a plain numeric string, matching what csv-parser would
   *  have handed back from a plain-text CSV field. */
  private async parseXlsx(localFilePath: string): Promise<{ fileName: string; rowCount: number; rows: Record<string, string>[] }> {
    const fileName = localFilePath.split(/[/\\]/).pop() ?? localFilePath;

    try {
      await stat(localFilePath);
    } catch {
      throw new NotFoundException(`File "${fileName}" was not found at ${localFilePath}`);
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const buffer = await readFile(localFilePath);
      await workbook.xlsx.load(buffer as any);

      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount === 0) {
        throw new BadRequestException(`"${fileName}" has no worksheet or is empty`);
      }

      const headerByColumn = new Map<number, string>();
      sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const text = cellToString(cell).trim();
        if (text) headerByColumn.set(colNumber, text);
      });

      const rows: Record<string, string>[] = [];
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const sheetRow = sheet.getRow(rowNumber);
        if (sheetRow.cellCount === 0) continue; // a fully blank row — ExcelJS can report trailing blank rows
        const row: Record<string, string> = {};
        headerByColumn.forEach((header, colNumber) => {
          row[header] = cellToString(sheetRow.getCell(colNumber)).trim();
        });
        rows.push(row);
      }

      this.logger.log(`Parsed ${rows.length} row${rows.length === 1 ? '' : 's'} from ${fileName} (.xlsx)`);
      return { fileName, rowCount: rows.length, rows };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to parse Excel workbook "${fileName}": ${message}`);
      throw new InternalServerErrorException('Failed to parse the Excel (.xlsx) file');
    }
  }
}
