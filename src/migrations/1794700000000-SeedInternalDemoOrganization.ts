import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * SaaS multi-tenancy, step 4 — creates the ONE internal/demo organization that every pre-existing
 * business row (the seeded Azizi Rivera community/property/unit tree, and any real data added since)
 * will be backfilled onto in a LATER migration, once every target table actually has an
 * organization_id column to backfill (that is its own migration — this one only creates the row).
 *
 * Deliberately named/coded so nobody mistakes it for a real paying client (per the explicit decision:
 * "do not delete existing demo data or treat it as a real paying client"). Idempotent by `code`.
 */
export class SeedInternalDemoOrganization1794700000000 implements MigrationInterface {
    name = 'SeedInternalDemoOrganization1794700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('organizations'))) return;

        const existing = await queryRunner.query(
            `SELECT id FROM \`organizations\` WHERE \`code\` = ?`,
            ['INTERNAL-DEMO'],
        );
        if (existing.length > 0) return;

        await queryRunner.query(
            `INSERT INTO \`organizations\` (\`name\`, \`code\`, \`organization_type\`, \`primary_contact_name\`, \`primary_contact_email\`, \`timezone\`, \`organization_status\`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['Internal Demo Organization', 'INTERNAL-DEMO', 'other', 'CCB Platform Team', 'platform@ccb.local', 'UTC', 'active'],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('organizations'))) return;

        await queryRunner.query(`DELETE FROM \`organizations\` WHERE \`code\` = ?`, ['INTERNAL-DEMO']);
    }
}
