// The estate-wide status for ONE calendar date's summary row — distinct
// from SftpIngestionStatus, which is per-FILE. Derived by
// EstateSummaryService from that date's SftpIngestionLog rows, never set
// directly by a caller.
export enum EstateIngestionStatus {
  // Every registered DTU's file was received and processed — files_missing
  // and files_failed are both 0.
  COMPLETE = 'complete',
  // At least one file was received/processed, but at least one DTU is
  // missing or failed — the ordinary "some DTUs didn't send today" case.
  PARTIAL = 'partial',
  // The cron never reached the per-file loop at all (SFTP connection
  // failed after every retry — see SftpCronService.runOnce()'s early
  // return), so zero SftpIngestionLog rows exist for this date at all.
  // Distinct from PARTIAL: this isn't "some DTUs missing", it's "the poll
  // itself never ran".
  FAILED = 'failed',
}
