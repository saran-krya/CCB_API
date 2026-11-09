import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * SaaS multi-tenancy, step 1 of the approved migration sequence (M1 in the plan — subscription_plans
 * is created before organizations since Organization.subscription_plan_id references it). A reusable
 * plan catalog, SUPER_ADMIN-managed; `null` on any max_* column means "unlimited" for that dimension.
 *
 * On a genuinely fresh install this table never needs to exist here — `synchronize` creates it (and
 * every other new entity's table) directly from the live entity definitions the moment the app boots,
 * same as this project's other hand-authored migrations (see AddBillRunTables's own note). This
 * migration only matters for an EXISTING database being upgraded, hence the hasTable guard.
 */
export class CreateSubscriptionPlansTable1794400000000 implements MigrationInterface {
    name = 'CreateSubscriptionPlansTable1794400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('subscription_plans')) return;

        await queryRunner.query(`CREATE TABLE \`subscription_plans\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`name\` varchar(120) NOT NULL, \`code\` varchar(50) NOT NULL, \`description\` text NULL, \`max_users\` int NULL, \`max_communities\` int NULL, \`max_properties\` int NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`IDX_subscription_plans_code\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('subscription_plans')) {
            await queryRunner.query(`DROP TABLE \`subscription_plans\``);
        }
    }
}
