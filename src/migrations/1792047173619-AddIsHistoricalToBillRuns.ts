import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `bill_runs.is_historical` — marks a BillRun as created via the Historical Billing workflow
 * (a missed billing-cycle version, submitted after the fact, through its own permission/approval
 * chain) rather than the routine current-cycle Bill Run path. Every existing row defaults to
 * `false`, which is correct: no existing BillRun was ever created through the historical path,
 * since it did not exist before this migration.
 *
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations.
 */
export class AddIsHistoricalToBillRuns1792047173619 implements MigrationInterface {
    name = 'AddIsHistoricalToBillRuns1792047173619'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('bill_runs', 'is_historical');
        if (!hasColumn) {
            await queryRunner.query(`ALTER TABLE \`bill_runs\` ADD \`is_historical\` tinyint NOT NULL DEFAULT 0`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('bill_runs', 'is_historical');
        if (hasColumn) {
            await queryRunner.query(`ALTER TABLE \`bill_runs\` DROP COLUMN \`is_historical\``);
        }
    }

}
