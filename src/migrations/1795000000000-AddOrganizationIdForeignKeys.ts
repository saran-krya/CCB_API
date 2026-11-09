import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * SaaS multi-tenancy, Phase B step 3 (B3) — adds the FK constraint (organization_id -> organizations.id)
 * on every table AddOrganizationIdColumns touched, now that BackfillOrganizationId has actually
 * populated the values. ON DELETE is NO ACTION everywhere: this codebase has no Organization
 * hard-delete path (only soft-delete via deleted_at and the PENDING/ACTIVE/SUSPENDED/INACTIVE status
 * lifecycle), and FK constraints are added without explicit names for the same reason AddBillRunTables
 * already documents — letting MySQL/TypeORM assign them avoids a synchronize-vs-migration name
 * collision in this project's dev environment.
 */
const ALL_TABLES = [
    'users', 'roles', 'policies', 'role_policies', 'policy_statements',
    'role_inline_policies', 'role_inline_policy_statements',
    'user_inline_policies', 'user_inline_policy_statements', 'audit_logs',
    'communities', 'properties', 'units', 'customers', 'company',
    'tariff_masters', 'tariff_versions',
    'billing_cycle_masters', 'billing_cycle_versions',
    'master_meters', 'sub_meters',
    'bills', 'bill_line_items', 'bill_runs', 'bill_run_batches',
    'registration_requests',
] as const;

export class AddOrganizationIdForeignKeys1795000000000 implements MigrationInterface {
    name = 'AddOrganizationIdForeignKeys1795000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('organizations'))) return;

        for (const table of ALL_TABLES) {
            if (!(await queryRunner.hasTable(table)) || !(await queryRunner.hasColumn(table, 'organization_id'))) continue;

            const existing = await queryRunner.query(
                `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'organization_id' AND REFERENCED_TABLE_NAME = 'organizations'`,
                [table],
            );
            if (existing.length === 0) {
                await queryRunner.query(`ALTER TABLE \`${table}\` ADD FOREIGN KEY (\`organization_id\`) REFERENCES \`organizations\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ALL_TABLES) {
            if (!(await queryRunner.hasTable(table))) continue;

            const rows = await queryRunner.query(
                `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'organization_id' AND REFERENCED_TABLE_NAME = 'organizations'`,
                [table],
            );
            for (const row of rows) {
                await queryRunner.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``);
            }
        }
    }
}
