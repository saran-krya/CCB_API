import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `customers.emergency_contact_relationship` — this value was already captured on the
 * registration request (`registration_customer_details.emergency_contact_relationship`) and
 * survived all the way to the registration response, but was silently dropped the moment a
 * Customer account was created: `toCreateCustomerDto()` never mapped it and no matching column
 * existed on `customers`, unlike its sibling fields `emergency_contact_name`/`_phone`, both of
 * which did survive the same handoff.
 *
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations.
 */
export class AddCustomerEmergencyContactRelationship1790674007367 implements MigrationInterface {
    name = 'AddCustomerEmergencyContactRelationship1790674007367'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('customers', 'emergency_contact_relationship');
        if (!hasColumn) {
            await queryRunner.query(`ALTER TABLE \`customers\` ADD \`emergency_contact_relationship\` varchar(40) NULL`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('customers', 'emergency_contact_relationship');
        if (hasColumn) {
            await queryRunner.query(`ALTER TABLE \`customers\` DROP COLUMN \`emergency_contact_relationship\``);
        }
    }

}
