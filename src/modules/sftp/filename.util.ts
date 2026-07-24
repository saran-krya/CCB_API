// Filenames on the real server follow DTU_<dtuId>_<YYYYMMDD>.csv (confirmed
// against the live EC2 server during the Download/Parse milestones). Shared
// between sftp-cron.service.ts (missing-DTU detection) and ingestion.service.ts
// (stamping SftpIngestionLog.reading_date) so both derive the same date from
// the same filename the same way — a plain module-level export rather than
// one importing the other, to avoid a circular import between the two.
export const DTU_FILENAME_PATTERN = /^DTU_(.+)_(\d{8})\.csv$/i;

// Returns the file's reading date as YYYY-MM-DD, or null if the filename
// doesn't match the expected pattern.
export function parseReadingDateFromFilename(fileName: string): string | null {
  const match = fileName.match(DTU_FILENAME_PATTERN);
  if (!match) return null;
  const [, , yyyymmdd] = match;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
