// Which caller invoked IngestionService.ingestFile() for this particular
// row — the nightly cron sweep, or a human-initiated manual retry/upload.
// Distinguishing the two lets a manual retrigger show up differently from
// the automated run in the audit trail and in retryCount bookkeeping.
export enum TriggerSource {
  CRON = 'cron',
  MANUAL = 'manual',
}
