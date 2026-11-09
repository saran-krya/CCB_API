import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * SaaS multi-tenancy, step 2 of the approved migration sequence (M1) — the tenant-isolation root every
 * business-owned row will eventually reference (added in a later migration, once Role/Policy scoping is
 * finalized). `subscription_plan_id` is nullable: an organization can exist (PENDING) before a plan is
 * assigned. No `organization_id`-bearing table yet references this one — that FK rollout is its own
 * later migration, once every target table's column has been added and backfilled (never done in the
 * same step as creating the parent table).
 *
 * hasTable-guarded for the same reason as CreateSubscriptionPlansTable: a fresh install gets this table
 * from `synchronize` directly, this migration only matters when upgrading an existing database.
 */
export class CreateOrganizationsTable1794500000000 implements MigrationInterface {
    name = 'CreateOrganizationsTable1794500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('organizations')) return;

        await queryRunner.query(`CREATE TABLE \`organizations\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`name\` varchar(160) NOT NULL, \`code\` varchar(50) NOT NULL, \`organization_type\` enum ('residential', 'commercial', 'mixed_use', 'other') NOT NULL DEFAULT 'other', \`primary_contact_name\` varchar(160) NOT NULL, \`primary_contact_email\` varchar(160) NOT NULL, \`primary_contact_phone\` varchar(30) NULL, \`address\` varchar(255) NULL, \`country\` varchar(100) NULL, \`timezone\` varchar(64) NOT NULL DEFAULT 'UTC', \`organization_status\` enum ('pending', 'active', 'suspended', 'inactive') NOT NULL DEFAULT 'pending', \`subscription_plan_id\` int NULL, \`subscription_start_date\` date NULL, \`subscription_expiry_date\` date NULL, UNIQUE INDEX \`IDX_organizations_code\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);

        if (await queryRunner.hasTable('subscription_plans')) {
            const existing = await queryRunner.query(
                `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND COLUMN_NAME = 'subscription_plan_id' AND REFERENCED_TABLE_NAME = 'subscription_plans'`,
            );
            if (existing.length === 0) {
                await queryRunner.query(`ALTER TABLE \`organizations\` ADD FOREIGN KEY (\`subscription_plan_id\`) REFERENCES \`subscription_plans\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('organizations')) {
            await queryRunner.query(`DROP TABLE \`organizations\``);
        }
    }
}
