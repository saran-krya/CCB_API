export const BYTES_PER_MB = 1024 * 1024;

/** Content type of an .xlsx workbook: what the meter import/export endpoints send and accept. */
export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Largest bulk-import file the meter import endpoints accept (10 MB). */
export const MAX_IMPORT_FILE_SIZE_BYTES = 10 * BYTES_PER_MB;
