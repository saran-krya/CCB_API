import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `customers.auto_pay_enabled` — the applicant's own explicit choice at registration, which
 * was previously accepted by CreateCustomerDto/UpdateCustomerDto but silently dropped since no
 * matching column existed; the API instead re-derived an "Auto-Pay" value for display purely from
 * whether the default payment method was a Card, ignoring what the user actually chose.
 *
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations.
 */
export class AddCustomerAutoPayEnabled1788430486950 implements MigrationInterface {
    name = 'AddCustomerAutoPayEnabled1788430486950'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('customers', 'auto_pay_enabled');
        if (!hasColumn) {
            await queryRunner.query(`ALTER TABLE \`customers\` ADD \`auto_pay_enabled\` tinyint NOT NULL DEFAULT 0`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('customers', 'auto_pay_enabled');
        if (hasColumn) {
            await queryRunner.query(`ALTER TABLE \`customers\` DROP COLUMN \`auto_pay_enabled\``);
        }
    }

}
