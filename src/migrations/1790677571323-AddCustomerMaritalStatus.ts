import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `customers.marital_status` — this value was already captured on the registration request
 * (`registration_customer_details.marital_status`), and `toCreateCustomerDto()` already mapped it
 * onto `CreateCustomerDto.maritalStatus`, but the frontend never actually sent the user's
 * selection (missing from `buildDraftPayload()`) and, independent of that, no migration had ever
 * added a matching column here — unlike its sibling profile fields `gender`/`nationality`/
 * `date_of_birth`, all of which did reach `customers` correctly. Both gaps are fixed together in
 * this change (frontend send/hydrate + this column); this migration covers the schema half.
 *
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations — including the case where the column already exists (e.g. added
 * outside the tracked migration history), in which case this is a no-op.
 */
export class AddCustomerMaritalStatus1790677571323 implements MigrationInterface {
    name = 'AddCustomerMaritalStatus1790677571323'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('customers', 'marital_status');
        if (!hasColumn) {
            await queryRunner.query(`ALTER TABLE \`customers\` ADD \`marital_status\` varchar(30) NULL`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('customers', 'marital_status');
        if (hasColumn) {
            await queryRunner.query(`ALTER TABLE \`customers\` DROP COLUMN \`marital_status\``);
        }
    }

}
