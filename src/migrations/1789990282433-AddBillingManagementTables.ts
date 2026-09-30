import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the Billing Management feature's two tables: `bills` (one row per unit per APPROVED bill
 * run — a real, unit-level financial document snapshot, never property-level) and
 * `bill_line_items` (Consumption Charge / Billing Service Fee / VAT breakdown per bill).
 *
 * UNIQUE(bill_run_id, unit_id) on `bills` is the DB-level duplicate-protection guard — one Bill per
 * Unit per Bill Run, enforced here as the final safeguard alongside the row-locked check inside
 * BillingManagementService.generateOneBill(); never relies on application logic alone.
 *
 * Foreign keys added WITHOUT explicit CONSTRAINT names, matching AddBillRunTables'/
 * AddFieldInspectionRequests' own established reasoning (avoids a synchronize:true dev-setting name
 * collision — see AddBillRunTables's own comment for the full history). Idempotent against re-running.
 */
export class AddBillingManagementTables1789990282433 implements MigrationInterface {
    name = 'AddBillingManagementTables1789990282433'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('bills'))) {
            await queryRunner.query(`CREATE TABLE \`bills\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`business_code\` varchar(20) NULL, \`bill_run_id\` int NOT NULL, \`property_id\` int NOT NULL, \`unit_id\` int NOT NULL, \`customer_id\` int NOT NULL, \`billing_cycle_master_id\` int NOT NULL, \`billing_cycle_version_id\` int NOT NULL, \`billing_period_start\` date NOT NULL, \`billing_period_end\` date NOT NULL, \`bill_issue_date\` date NOT NULL, \`bill_due_date\` date NOT NULL, \`consumption_kwh\` decimal(14,4) NOT NULL, \`tariff_version_id\` int NOT NULL, \`tariff_rate_snapshot\` decimal(10,4) NOT NULL, \`billing_service_fee_snapshot\` decimal(10,2) NOT NULL, \`vat_rate_snapshot\` decimal(5,2) NOT NULL, \`subtotal\` decimal(12,2) NOT NULL, \`vat_amount\` decimal(12,2) NOT NULL, \`total_due\` decimal(12,2) NOT NULL, \`status\` enum ('pending_review', 'issued', 'cancelled') NOT NULL DEFAULT 'pending_review', \`generated_at\` datetime NOT NULL, \`generated_by_id\` int NULL, \`issued_at\` datetime NULL, \`issued_by_id\` int NULL, \`cancelled_at\` datetime NULL, \`cancelled_by_id\` int NULL, \`cancellation_reason\` text NULL, \`replaces_bill_id\` int NULL, UNIQUE INDEX \`IDX_bills_business_code\` (\`business_code\`), UNIQUE INDEX \`IDX_bills_bill_run_unit\` (\`bill_run_id\`, \`unit_id\`), INDEX \`IDX_bills_property\` (\`property_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }

        if (!(await queryRunner.hasTable('bill_line_items'))) {
            await queryRunner.query(`CREATE TABLE \`bill_line_items\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`bill_id\` int NOT NULL, \`line_type\` enum ('consumption_charge', 'billing_service_fee', 'vat') NOT NULL, \`description\` varchar(255) NOT NULL, \`quantity\` decimal(14,4) NULL, \`unit_rate\` decimal(10,4) NULL, \`amount\` decimal(12,2) NOT NULL, \`taxable\` tinyint NOT NULL DEFAULT 0, \`display_order\` smallint NOT NULL, INDEX \`IDX_bill_line_items_bill\` (\`bill_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }

        const addFkIfMissing = async (table: string, column: string, refTable: string, onDelete: 'SET NULL' | 'NO ACTION' | 'CASCADE') => {
            const existing = await queryRunner.query(
                `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?`,
                [table, column, refTable],
            );
            if (existing.length === 0) {
                await queryRunner.query(`ALTER TABLE \`${table}\` ADD FOREIGN KEY (\`${column}\`) REFERENCES \`${refTable}\`(\`id\`) ON DELETE ${onDelete} ON UPDATE NO ACTION`);
            }
        };

        await addFkIfMissing('bills', 'bill_run_id', 'bill_runs', 'NO ACTION');
        await addFkIfMissing('bills', 'property_id', 'properties', 'NO ACTION');
        await addFkIfMissing('bills', 'unit_id', 'units', 'NO ACTION');
        await addFkIfMissing('bills', 'customer_id', 'customers', 'NO ACTION');
        await addFkIfMissing('bills', 'billing_cycle_master_id', 'billing_cycle_masters', 'NO ACTION');
        await addFkIfMissing('bills', 'billing_cycle_version_id', 'billing_cycle_versions', 'NO ACTION');
        await addFkIfMissing('bills', 'tariff_version_id', 'tariff_versions', 'NO ACTION');
        await addFkIfMissing('bills', 'generated_by_id', 'users', 'SET NULL');
        await addFkIfMissing('bills', 'issued_by_id', 'users', 'SET NULL');
        await addFkIfMissing('bills', 'cancelled_by_id', 'users', 'SET NULL');
        await addFkIfMissing('bills', 'replaces_bill_id', 'bills', 'SET NULL');
        await addFkIfMissing('bill_line_items', 'bill_id', 'bills', 'CASCADE');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('bill_line_items')) {
            await queryRunner.query(`DROP TABLE \`bill_line_items\``);
        }
        if (await queryRunner.hasTable('bills')) {
            await queryRunner.query(`DROP TABLE \`bills\``);
        }
    }
}
