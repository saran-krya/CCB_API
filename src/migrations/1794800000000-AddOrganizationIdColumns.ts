import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * SaaS multi-tenancy, Phase B step 1 (B1) — adds `organization_id` to every tenant-owned table,
 * NULLABLE and WITHOUT a foreign key constraint yet. This is the safe, purely-additive first step of
 * the documented nullable -> backfill -> FK -> NOT NULL -> org-scoped-unique sequence: nothing here
 * can fail against existing rows, and nothing here enforces anything yet (the next migrations in the
 * sequence do that, once the backfill below has actually populated every row).
 *
 * `users`/`roles`/`policies`/`role_policies`/`policy_statements`/`role_inline_policies`/
 * `role_inline_policy_statements`/`user_inline_policies`/`user_inline_policy_statements` stay
 * NULLABLE forever (NULL = platform-level SUPER_ADMIN's own rows, or rows that inherit it) — every
 * other table here gets its NOT NULL constraint in a LATER migration, once backfill is confirmed
 * complete (see AddOrganizationIdBackfill, AddOrganizationIdNotNullConstraints).
 *
 * hasTable/hasColumn-guarded, matching this project's other hand-authored migrations — on a fresh
 * install these tables don't exist yet when migrations run (synchronize creates them, with the
 * column already on them, right after).
 */
const NULLABLE_FOREVER_TABLES = [
    'users',
    'roles',
    'policies',
    'role_policies',
    'policy_statements',
    'role_inline_policies',
    'role_inline_policy_statements',
    'user_inline_policies',
    'user_inline_policy_statements',
    // NULL = a platform-level action (SUPER_ADMIN managing an Organization itself) with no single
    // tenant the entry belongs to — see AuditLog's own doc comment.
    'audit_logs',
] as const;

const EVENTUALLY_NOT_NULL_TABLES = [
    'communities',
    'properties',
    'units',
    'customers',
    'company',
    'tariff_masters',
    'tariff_versions',
    'billing_cycle_masters',
    'billing_cycle_versions',
    'master_meters',
    'sub_meters',
    'bills',
    'bill_line_items',
    'bill_runs',
    'bill_run_batches',
    'registration_requests',
] as const;

const ALL_TABLES = [...NULLABLE_FOREVER_TABLES, ...EVENTUALLY_NOT_NULL_TABLES];

export class AddOrganizationIdColumns1794800000000 implements MigrationInterface {
    name = 'AddOrganizationIdColumns1794800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const table of ALL_TABLES) {
            if (!(await queryRunner.hasTable(table))) continue;
            if (await queryRunner.hasColumn(table, 'organization_id')) continue;

            await queryRunner.query(`ALTER TABLE \`${table}\` ADD \`organization_id\` int NULL`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ALL_TABLES) {
            if (!(await queryRunner.hasTable(table))) continue;
            if (!(await queryRunner.hasColumn(table, 'organization_id'))) continue;

            await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`organization_id\``);
        }
    }
}
