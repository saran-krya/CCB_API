import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * SaaS multi-tenancy, Phase B step 2 (B2) — backfills the nullable organization_id columns added by
 * AddOrganizationIdColumns onto the one INTERNAL-DEMO organization seeded by
 * SeedInternalDemoOrganization, with the documented exception: the platform SUPER_ADMIN role, its
 * system-managed policy, and any user holding that role are left organization_id = NULL (platform-
 * level, per the approved architecture). Every row that inherits its organization_id from an owning
 * Role/Policy/User (role_policies, policy_statements, role_inline_policies and their statements,
 * user_inline_policies and their statements) copies whatever that owner ended up with — including
 * staying NULL when the owner is the SUPER_ADMIN role/policy/user itself.
 *
 * Plain business tables (communities, properties, ... registration_requests) have no such exception:
 * every pre-existing row belongs to the one organization that has existed so far.
 *
 * `audit_logs.organization_id` is backfilled from the PERFORMING user's organization_id at this
 * moment (a one-time snapshot, matching the column's own documented semantics) — NULL stays NULL for
 * an entry performed by a SUPER_ADMIN user (or one performed by the system actor, performed_by NULL).
 *
 * SUPER_ADMIN is matched by `role_name = 'SUPER_ADMIN'` directly (not a JS-side canonicalization) —
 * this codebase's own code comments confirm MySQL's default collation already compares role names
 * case/accent-insensitively, which is exactly why the application needs `canonicalRoleName()` in JS
 * but a raw SQL comparison here does not.
 *
 * Deliberately idempotent-safe to re-run (every UPDATE only touches rows still at NULL), but its
 * down() is ONLY safe to run while the INTERNAL-DEMO organization remains the ONLY organization with
 * real data — see this migration's own down() for the explicit guard against running on a database
 * that has since onboarded a second organization, per the documented migration-safety rule.
 */
export class BackfillOrganizationId1794900000000 implements MigrationInterface {
    name = 'BackfillOrganizationId1794900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('organizations'))) return;

        const orgRows = await queryRunner.query(`SELECT id FROM \`organizations\` WHERE \`code\` = ?`, ['INTERNAL-DEMO']);
        if (orgRows.length === 0) return;
        const internalOrgId = orgRows[0].id;

        const plainBusinessTables = [
            'communities', 'properties', 'units', 'customers', 'company',
            'tariff_masters', 'tariff_versions',
            'billing_cycle_masters', 'billing_cycle_versions',
            'master_meters', 'sub_meters',
            'bills', 'bill_line_items', 'bill_runs', 'bill_run_batches',
            'registration_requests',
        ];
        for (const table of plainBusinessTables) {
            if (!(await queryRunner.hasTable(table))) continue;
            await queryRunner.query(`UPDATE \`${table}\` SET \`organization_id\` = ? WHERE \`organization_id\` IS NULL`, [internalOrgId]);
        }

        if (await queryRunner.hasTable('roles')) {
            await queryRunner.query(
                `UPDATE \`roles\` SET \`organization_id\` = ? WHERE \`organization_id\` IS NULL AND \`role_name\` != 'SUPER_ADMIN'`,
                [internalOrgId],
            );
        }
        if (await queryRunner.hasTable('policies')) {
            await queryRunner.query(
                `UPDATE \`policies\` SET \`organization_id\` = ? WHERE \`organization_id\` IS NULL AND \`is_system\` = 0`,
                [internalOrgId],
            );
        }
        if (await queryRunner.hasTable('users')) {
            await queryRunner.query(
                `UPDATE \`users\` SET \`organization_id\` = ? WHERE \`organization_id\` IS NULL AND \`id\` NOT IN (
                   SELECT ur.\`user_id\` FROM \`user_roles\` ur JOIN \`roles\` r ON ur.\`role_id\` = r.\`id\` WHERE r.\`role_name\` = 'SUPER_ADMIN'
                 )`,
                [internalOrgId],
            );
        }

        // Inherit-from-owner rows — always copy, never re-derive, so a row's scope always matches
        // its real owner regardless of whether that owner is NULL (SUPER_ADMIN) or a real org.
        const inheritFromOwner = async (childTable: string, ownerTable: string, fkColumn: string) => {
            if (!(await queryRunner.hasTable(childTable)) || !(await queryRunner.hasTable(ownerTable))) return;
            await queryRunner.query(
                `UPDATE \`${childTable}\` c JOIN \`${ownerTable}\` o ON c.\`${fkColumn}\` = o.\`id\`
                 SET c.\`organization_id\` = o.\`organization_id\` WHERE c.\`organization_id\` IS NULL`,
            );
        };
        await inheritFromOwner('role_policies', 'roles', 'roleId');
        await inheritFromOwner('policy_statements', 'policies', 'policyId');
        await inheritFromOwner('role_inline_policies', 'roles', 'roleId');
        await inheritFromOwner('role_inline_policy_statements', 'role_inline_policies', 'policyId');
        await inheritFromOwner('user_inline_policies', 'users', 'userId');
        await inheritFromOwner('user_inline_policy_statements', 'user_inline_policies', 'policyId');

        if (await queryRunner.hasTable('audit_logs') && await queryRunner.hasTable('users')) {
            await queryRunner.query(
                `UPDATE \`audit_logs\` al JOIN \`users\` u ON al.\`performed_by\` = u.\`id\`
                 SET al.\`organization_id\` = u.\`organization_id\` WHERE al.\`organization_id\` IS NULL`,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('organizations'))) return;

        const orgRows = await queryRunner.query(`SELECT id FROM \`organizations\` WHERE \`code\` = ?`, ['INTERNAL-DEMO']);
        if (orgRows.length === 0) return;
        const internalOrgId = orgRows[0].id;

        // Safety guard, per the documented migration-safety rule: this down() blindly nulls every
        // organization_id this migration set — correct ONLY while INTERNAL-DEMO is still the only
        // organization with real data. Once a second organization has been onboarded, reverting here
        // would destroy real tenant-scoping information, so this refuses outright instead.
        const orgCountRows = await queryRunner.query(`SELECT COUNT(*) as cnt FROM \`organizations\``);
        if (Number(orgCountRows[0].cnt) > 1) {
            throw new Error(
                'Refusing to revert BackfillOrganizationId: more than one organization exists. ' +
                'Reverting this backfill now would destroy real tenant-scoping data — this requires a manual, supervised data reconciliation, not an automatic migration:revert.',
            );
        }

        const allBackfilledTables = [
            'communities', 'properties', 'units', 'customers', 'company',
            'tariff_masters', 'tariff_versions',
            'billing_cycle_masters', 'billing_cycle_versions',
            'master_meters', 'sub_meters',
            'bills', 'bill_line_items', 'bill_runs', 'bill_run_batches',
            'registration_requests', 'roles', 'policies', 'users',
            'role_policies', 'policy_statements', 'role_inline_policies',
            'role_inline_policy_statements', 'user_inline_policies', 'user_inline_policy_statements',
            'audit_logs',
        ];
        for (const table of allBackfilledTables) {
            if (!(await queryRunner.hasTable(table))) continue;
            await queryRunner.query(`UPDATE \`${table}\` SET \`organization_id\` = NULL WHERE \`organization_id\` = ?`, [internalOrgId]);
        }
    }
}
