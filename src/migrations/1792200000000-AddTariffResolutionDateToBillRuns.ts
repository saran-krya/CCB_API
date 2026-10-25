import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `bill_runs.tariff_resolution_date` — nullable, set ONLY for a BillRun whose cyclePeriodStart/
 * End were explicitly resolved from a past reading date (Missed Reading Recovery) rather than
 * today-anchored current-cycle resolution. Stores the resolved period's own start date, used
 * exclusively by BillingManagementService.generateBillsForBillRun to decide whether to call
 * TariffService.resolveForUnitsAsOf(unitIds, thisDate) instead of the routine resolveForUnits — it
 * feeds no other decision (never workflow type, permissions, or approval routing). Every existing
 * row and every routine submission going forward defaults to NULL, which is correct: no BillRun
 * created before this feature, or through the routine path, was ever resolved this way.
 *
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations.
 */
export class AddTariffResolutionDateToBillRuns1792200000000 implements MigrationInterface {
    name = 'AddTariffResolutionDateToBillRuns1792200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fresh install: `bill_runs` doesn't exist yet — AddBillRunTables itself skips creating it
        // when its own FK dependencies (users/properties/billing_cycle_masters/billing_cycle_versions)
        // aren't there yet (migrations run before `synchronize: true` does — see 1788342228029's own
        // comment for the confirmed cold-start evidence), and `queryRunner.hasColumn` throws outright
        // on a missing table. Safe to skip: `synchronize` creates `bill_runs` immediately after
        // migrations finish, with this column already on it from the current BillRun entity definition.
        if (!(await queryRunner.hasTable('bill_runs'))) return;

        const hasColumn = await queryRunner.hasColumn('bill_runs', 'tariff_resolution_date');
        if (!hasColumn) {
            await queryRunner.query(`ALTER TABLE \`bill_runs\` ADD \`tariff_resolution_date\` date NULL`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('bill_runs', 'tariff_resolution_date');
        if (hasColumn) {
            await queryRunner.query(`ALTER TABLE \`bill_runs\` DROP COLUMN \`tariff_resolution_date\``);
        }
    }

}
