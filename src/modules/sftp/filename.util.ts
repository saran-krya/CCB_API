export const DTU_FILENAME_PATTERN = /^DTU_(.+)_(\d{8})\.csv$/i;

export function parseReadingDateFromFilename(fileName: string): string | null {
  const match = fileName.match(DTU_FILENAME_PATTERN);
  if (!match) return null;
  const [, , yyyymmdd] = match;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
