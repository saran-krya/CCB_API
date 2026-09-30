import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the Bill Run feature's two tables: `bill_run_batches` (groups multiple bill runs submitted
 * together via the estate-wide batch flow — an individual submission never gets a batch row) and
 * `bill_runs` (one row per property + billing-cycle-version submission, real lifecycle status,
 * pre-bill-validation snapshot at submission time, and a self-referencing `resubmitted_from_id`
 * for correct-and-resubmit history). No 'Dispatched' status/invoice linkage exists — no Invoice
 * module exists yet in this codebase; `approved` is the deliberate terminal state a future Invoice
 * module would integrate against.
 *
 * Foreign keys are added WITHOUT explicit CONSTRAINT names (letting MySQL/TypeORM assign their own)
 * deliberately — an earlier version of this migration hand-named them, which collided with this
 * project's `synchronize: true` dev setting (TypeORM's own auto-generated FK name for the same
 * relation didn't match the hand-picked name, so schema-sync got stuck trying to reconcile the two
 * on every app start: "Cannot drop index ... needed in a foreign key constraint"). Letting the
 * database assign names avoids that collision entirely and matches how every other entity in this
 * codebase is actually created in practice (via synchronize, never a name explicitly authored here).
 *
 * Idempotent against re-running (checks table existence first), matching this project's other
 * hand-authored migrations.
 */
export class AddBillRunTables1789705894645 implements MigrationInterface {
    name = 'AddBillRunTables1789705894645'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('bill_run_batches'))) {
            await queryRunner.query(`CREATE TABLE \`bill_run_batches\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`business_code\` varchar(20) NULL, \`submitted_by_id\` int NULL, \`submitted_on\` datetime NOT NULL, \`notes\` text NULL, UNIQUE INDEX \`IDX_bill_run_batches_business_code\` (\`business_code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }

        if (!(await queryRunner.hasTable('bill_runs'))) {
            await queryRunner.query(`CREATE TABLE \`bill_runs\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`business_code\` varchar(20) NULL, \`batch_id\` int NULL, \`property_id\` int NOT NULL, \`cycle_master_id\` int NOT NULL, \`cycle_version_id\` int NOT NULL, \`cycle_period_start\` date NOT NULL, \`cycle_period_end\` date NOT NULL, \`bill_issue_date\` date NOT NULL, \`bill_due_date\` date NOT NULL, \`status\` enum ('pending_approval', 'returned_for_correction', 'approved', 'rejected') NOT NULL DEFAULT 'pending_approval', \`billable_units\` int NOT NULL, \`units_missing_tariff\` int NOT NULL, \`units_missing_meter_mapping\` int NOT NULL, \`units_missing_reading\` int NOT NULL, \`critical_anomalies\` int NOT NULL, \`high_anomalies\` int NOT NULL, \`notes\` text NULL, \`submitted_by_id\` int NULL, \`submitted_on\` datetime NOT NULL, \`reviewed_by_id\` int NULL, \`reviewed_on\` datetime NULL, \`review_notes\` text NULL, \`resubmitted_from_id\` int NULL, UNIQUE INDEX \`IDX_bill_runs_business_code\` (\`business_code\`), INDEX \`IDX_bill_runs_property_cycle_status\` (\`property_id\`, \`cycle_version_id\`, \`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }

        const addFkIfMissing = async (table: string, column: string, refTable: string, onDelete: 'SET NULL' | 'NO ACTION') => {
            const existing = await queryRunner.query(
                `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?`,
                [table, column, refTable],
            );
            if (existing.length === 0) {
                await queryRunner.query(`ALTER TABLE \`${table}\` ADD FOREIGN KEY (\`${column}\`) REFERENCES \`${refTable}\`(\`id\`) ON DELETE ${onDelete} ON UPDATE NO ACTION`);
            }
        };

        await addFkIfMissing('bill_run_batches', 'submitted_by_id', 'users', 'SET NULL');
        await addFkIfMissing('bill_runs', 'batch_id', 'bill_run_batches', 'SET NULL');
        await addFkIfMissing('bill_runs', 'property_id', 'properties', 'NO ACTION');
        await addFkIfMissing('bill_runs', 'cycle_master_id', 'billing_cycle_masters', 'NO ACTION');
        await addFkIfMissing('bill_runs', 'cycle_version_id', 'billing_cycle_versions', 'NO ACTION');
        await addFkIfMissing('bill_runs', 'submitted_by_id', 'users', 'SET NULL');
        await addFkIfMissing('bill_runs', 'reviewed_by_id', 'users', 'SET NULL');
        await addFkIfMissing('bill_runs', 'resubmitted_from_id', 'bill_runs', 'SET NULL');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('bill_runs')) {
            await queryRunner.query(`DROP TABLE \`bill_runs\``);
        }
        if (await queryRunner.hasTable('bill_run_batches')) {
            await queryRunner.query(`DROP TABLE \`bill_run_batches\``);
        }
    }
}
