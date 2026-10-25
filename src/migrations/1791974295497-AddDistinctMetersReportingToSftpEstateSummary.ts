import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `sftp_estate_summary.distinct_meters_reporting` — a per-day count of DISTINCT sub_meter_id
 * values in meter_readings for that reading_date, counting only rows that resolved to a real,
 * known SubMeter (sub_meter_id IS NOT NULL). This replaces the previous "Meters Received" KPI,
 * which was actually a raw CSV row count (SftpIngestionLog.received_meter_count, i.e.
 * rowResult.totalRows at ingestion time) and could overcount real meter coverage whenever a file
 * contained duplicate rows for the same meter or rows that never resolved to a real sub-meter.
 *
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations.
 */
export class AddDistinctMetersReportingToSftpEstateSummary1791974295497 implements MigrationInterface {
    name = 'AddDistinctMetersReportingToSftpEstateSummary1791974295497'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fresh install: `sftp_estate_summary` doesn't exist yet (migrations run before
        // `synchronize: true` does — see 1788342228029's own comment for the confirmed cold-start
        // evidence), and `queryRunner.hasColumn` throws outright on a missing table rather than
        // returning false. Safe to skip: `synchronize` creates `sftp_estate_summary` immediately
        // after migrations finish, with this column already on it from the current entity definition.
        if (!(await queryRunner.hasTable('sftp_estate_summary'))) return;

        const hasColumn = await queryRunner.hasColumn('sftp_estate_summary', 'distinct_meters_reporting');
        if (!hasColumn) {
            await queryRunner.query(`ALTER TABLE \`sftp_estate_summary\` ADD \`distinct_meters_reporting\` int unsigned NOT NULL DEFAULT 0`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('sftp_estate_summary', 'distinct_meters_reporting');
        if (hasColumn) {
            await queryRunner.query(`ALTER TABLE \`sftp_estate_summary\` DROP COLUMN \`distinct_meters_reporting\``);
        }
    }

}
