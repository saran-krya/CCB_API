// Matches both accepted reading-file extensions (see SftpService.ACCEPTED_READING_FILE_EXTENSIONS)
// — not a hard ingestion gate (a non-matching filename just leaves `readingDate` null on the log
// and skips the missing-DTU check, see SftpCronService.checkMissingDtus's own doc comment), but it
// must still recognize `.xlsx` the same as `.csv` or an Excel file's reading date would silently
// never populate even though the file itself ingests successfully.
export const DTU_FILENAME_PATTERN = /^DTU_(.+)_(\d{8})\.(csv|xlsx)$/i;

export function parseReadingDateFromFilename(fileName: string): string | null {
  const match = fileName.match(DTU_FILENAME_PATTERN);
  if (!match) return null;
  const [, , yyyymmdd] = match;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
