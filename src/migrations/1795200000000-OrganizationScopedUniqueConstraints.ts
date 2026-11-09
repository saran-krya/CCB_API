import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * SaaS multi-tenancy, Phase B step 5 (B5) — replaces the old GLOBAL unique constraints on
 * `roles.role_name` and `policies.name` with ORGANIZATION-SCOPED ones, so two different
 * organizations may each have their own role/policy named the same thing. `SUPER_ADMIN` itself stays
 * globally reserved regardless — enforced at the application layer (RoleService.RESERVED_ROLE_NAMES),
 * independent of this DB constraint, exactly as already documented on the Role/Policy entities.
 *
 * NULL is never equal to NULL in a MySQL unique index, so the one SUPER_ADMIN role/policy
 * (organization_id IS NULL) is automatically exempt from colliding with any real organization's own
 * role/policy of the same name — no special-casing needed in the constraint itself.
 *
 * ONLY safe to run after MakeOrganizationIdNotNull... no — `roles`/`policies` stay NULLABLE forever
 * (see AddOrganizationIdColumns), so this migration only depends on BackfillOrganizationId having run,
 * not on the NOT-NULL step. Finds the existing auto-generated unique index by introspection rather
 * than assuming a name, since none was ever hand-picked for it (see AddBillRunTables' own note on why
 * this project never hand-names constraints).
 */
export class OrganizationScopedUniqueConstraints1795200000000 implements MigrationInterface {
    name = 'OrganizationScopedUniqueConstraints1795200000000'

    private async dropExistingUniqueIndex(queryRunner: QueryRunner, table: string, column: string): Promise<string | null> {
        const rows = await queryRunner.query(
            `SELECT DISTINCT s.INDEX_NAME FROM information_schema.STATISTICS s
             WHERE s.TABLE_SCHEMA = DATABASE() AND s.TABLE_NAME = ? AND s.COLUMN_NAME = ? AND s.NON_UNIQUE = 0 AND s.INDEX_NAME != 'PRIMARY'`,
            [table, column],
        );
        for (const row of rows) {
            // Only drop a SINGLE-column unique index on exactly this column (never a composite one —
            // if the composite org-scoped index already exists from a previous run, leave it alone).
            const cols = await queryRunner.query(
                `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
                [table, row.INDEX_NAME],
            );
            if (Number(cols[0].cnt) === 1) {
                await queryRunner.query(`ALTER TABLE \`${table}\` DROP INDEX \`${row.INDEX_NAME}\``);
                return row.INDEX_NAME;
            }
        }
        return null;
    }

    private async addCompositeUniqueIfMissing(queryRunner: QueryRunner, table: string, indexName: string, columns: string[]): Promise<void> {
        const existing = await queryRunner.query(
            `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
            [table, indexName],
        );
        if (Number(existing[0].cnt) > 0) return;

        await queryRunner.query(`ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${indexName}\` (${columns.map((c) => `\`${c}\``).join(', ')})`);
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('roles')) {
            await this.dropExistingUniqueIndex(queryRunner, 'roles', 'role_name');
            await this.addCompositeUniqueIfMissing(queryRunner, 'roles', 'IDX_roles_organization_role_name', ['organization_id', 'role_name']);
        }
        if (await queryRunner.hasTable('policies')) {
            await this.dropExistingUniqueIndex(queryRunner, 'policies', 'name');
            await this.addCompositeUniqueIfMissing(queryRunner, 'policies', 'IDX_policies_organization_name', ['organization_id', 'name']);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverting to a global unique constraint is only safe if no two organizations currently hold
        // the same role/policy name — refuse rather than risk a silent failure or data loss.
        if (await queryRunner.hasTable('roles')) {
            const dupes = await queryRunner.query(
                `SELECT role_name, COUNT(*) as cnt FROM \`roles\` GROUP BY role_name HAVING cnt > 1`,
            );
            if (dupes.length > 0) {
                throw new Error('Refusing to revert roles unique constraint: duplicate role_name values exist across organizations.');
            }
            const rows = await queryRunner.query(
                `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND INDEX_NAME = 'IDX_roles_organization_role_name'`,
            );
            if (Number(rows[0].cnt) > 0) {
                await queryRunner.query(`ALTER TABLE \`roles\` DROP INDEX \`IDX_roles_organization_role_name\``);
                await queryRunner.query(`ALTER TABLE \`roles\` ADD UNIQUE INDEX \`IDX_roles_role_name\` (\`role_name\`)`);
            }
        }
        if (await queryRunner.hasTable('policies')) {
            const dupes = await queryRunner.query(
                `SELECT name, COUNT(*) as cnt FROM \`policies\` GROUP BY name HAVING cnt > 1`,
            );
            if (dupes.length > 0) {
                throw new Error('Refusing to revert policies unique constraint: duplicate name values exist across organizations.');
            }
            const rows = await queryRunner.query(
                `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'policies' AND INDEX_NAME = 'IDX_policies_organization_name'`,
            );
            if (Number(rows[0].cnt) > 0) {
                await queryRunner.query(`ALTER TABLE \`policies\` DROP INDEX \`IDX_policies_organization_name\``);
                await queryRunner.query(`ALTER TABLE \`policies\` ADD UNIQUE INDEX \`IDX_policies_name\` (\`name\`)`);
            }
        }
    }
}
