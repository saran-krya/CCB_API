import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * SaaS multi-tenancy, Phase B step 4 (B4) — flips `organization_id` to NOT NULL on every plain
 * business table (never on users/roles/policies/role_policies/policy_statements/
 * role_inline_policies(+statements)/user_inline_policies(+statements)/audit_logs — NULL is a
 * permanent, meaningful state on those, reserved for the platform SUPER_ADMIN's own rows or a
 * platform-level audit entry). Verifies zero remaining NULLs on each table before altering it and
 * throws rather than proceeding if backfill was incomplete — never silently coerces missing data.
 */
const TABLES = [
    'communities', 'properties', 'units', 'customers', 'company',
    'tariff_masters', 'tariff_versions',
    'billing_cycle_masters', 'billing_cycle_versions',
    'master_meters', 'sub_meters',
    'bills', 'bill_line_items', 'bill_runs', 'bill_run_batches',
    'registration_requests',
] as const;

export class MakeOrganizationIdNotNull1795100000000 implements MigrationInterface {
    name = 'MakeOrganizationIdNotNull1795100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const table of TABLES) {
            if (!(await queryRunner.hasTable(table)) || !(await queryRunner.hasColumn(table, 'organization_id'))) continue;

            const nullRows = await queryRunner.query(`SELECT COUNT(*) as cnt FROM \`${table}\` WHERE \`organization_id\` IS NULL`);
            if (Number(nullRows[0].cnt) > 0) {
                throw new Error(
                    `Refusing to make ${table}.organization_id NOT NULL: ${nullRows[0].cnt} row(s) still have no organization_id. Run/verify BackfillOrganizationId first.`,
                );
            }

            await queryRunner.query(`ALTER TABLE \`${table}\` MODIFY \`organization_id\` int NOT NULL`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of TABLES) {
            if (!(await queryRunner.hasTable(table)) || !(await queryRunner.hasColumn(table, 'organization_id'))) continue;

            await queryRunner.query(`ALTER TABLE \`${table}\` MODIFY \`organization_id\` int NULL`);
        }
    }
}
