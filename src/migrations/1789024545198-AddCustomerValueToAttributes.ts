import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `customer_value` (nullable) to `attributes` — the smallest reusable extension to let Admin
 * configure a Customer-facing override independent of the existing Staff/User `value` column,
 * without a second table or duplicate keys per audience. NULL (the default for every existing row,
 * and for every attribute going forward unless an Admin explicitly sets one) means "no override" —
 * a Customer-facing read falls back to the same global `value`, so every attribute's behavior is
 * unchanged until this column is deliberately populated (see AttributeService.getCustomerValueByKey).
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations (e.g. AddPrincipalTypeToAuthTables).
 */
export class AddCustomerValueToAttributes1789024545198 implements MigrationInterface {
    name = 'AddCustomerValueToAttributes1789024545198'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('attributes', 'customer_value'))) {
            await queryRunner.query(`ALTER TABLE \`attributes\` ADD \`customer_value\` text NULL`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('attributes', 'customer_value')) {
            await queryRunner.query(`ALTER TABLE \`attributes\` DROP COLUMN \`customer_value\``);
        }
    }
}
