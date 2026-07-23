// Lifecycle of one processed SFTP file, in the order a real run passes
// through them (FAILED can follow any of the first three states). MISSING
// is the odd one out — it's never reached by a real file at all; it's what
// the cron's Missing File Engine writes for a DTU that was expected but
// never sent anything this run (see SftpCronService.checkMissingDtus()).
// DUPLICATE is its own terminal state, not a variant of FAILED — a re-
// delivered file isn't an error, so it must never contribute to
// valid_reading_count/received_meter_count/anomaly_count totals the way a
// FAILED row legitimately can (see IngestionService.ingestFile()).
export enum SftpIngestionStatus {
  DOWNLOADED = 'downloaded',
  VALIDATED = 'validated',
  PROCESSED = 'processed',
  FAILED = 'failed',
  MISSING = 'missing',
  DUPLICATE = 'duplicate',
}
