import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `sftp_ingestion_logs.duplicate_reading_count` — a per-file summary count of rows skipped
 * during ingestion because they matched an existing (sub_meter_id, reading_date) reading
 * (reading-level duplicate-reading conflict, distinct from the existing file-level SHA-256
 * duplicate-file detection). Populated by IngestionService.ingestFile() alongside its sibling
 * counters (received_meter_count, valid_reading_count, anomaly_count, etc.).
 *
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations.
 */
export class AddDuplicateReadingCountToSftpIngestionLogs1791400000000 implements MigrationInterface {
    name = 'AddDuplicateReadingCountToSftpIngestionLogs1791400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fresh install: `sftp_ingestion_logs` doesn't exist yet (migrations run before
        // `synchronize: true` does — see 1788342228029's own comment for the confirmed cold-start
        // evidence), and `queryRunner.hasColumn` throws outright on a missing table rather than
        // returning false. Safe to skip: `synchronize` creates `sftp_ingestion_logs` immediately
        // after migrations finish, with this column already on it from the current entity definition.
        if (!(await queryRunner.hasTable('sftp_ingestion_logs'))) return;

        const hasColumn = await queryRunner.hasColumn('sftp_ingestion_logs', 'duplicate_reading_count');
        if (!hasColumn) {
            await queryRunner.query(`ALTER TABLE \`sftp_ingestion_logs\` ADD \`duplicate_reading_count\` int unsigned NOT NULL DEFAULT 0`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('sftp_ingestion_logs', 'duplicate_reading_count');
        if (hasColumn) {
            await queryRunner.query(`ALTER TABLE \`sftp_ingestion_logs\` DROP COLUMN \`duplicate_reading_count\``);
        }
    }

}
