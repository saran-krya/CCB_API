import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the Field Inspection feature's two tables: `field_inspection_requests` (one row per
 * submitted "Request Field Inspection" form — property, inspection details, assignee, notify
 * list, status) and `field_inspection_request_readings` (many-to-many join to `meter_readings`,
 * the specific anomalous readings a request covers — once a reading is linked here it's excluded
 * from being selectable again, the real equivalent of the Template's in-memory "locked" rule).
 * Also adds `roles.can_be_field_inspector` (mirrors the existing `can_be_reporting_manager` flag)
 * so "Assign To" targets real, role-eligible staff users rather than a fictional Team concept.
 *
 * Foreign keys added WITHOUT explicit CONSTRAINT names, matching AddBillRunTables's own established
 * reasoning (avoids a synchronize:true dev-setting name collision — see that migration's comment).
 * Idempotent against re-running.
 */
export class AddFieldInspectionRequests1789983744793 implements MigrationInterface {
    name = 'AddFieldInspectionRequests1789983744793'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const roleColumns = await queryRunner.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'can_be_field_inspector'`,
        );
        if (roleColumns.length === 0) {
            await queryRunner.query(`ALTER TABLE \`roles\` ADD \`can_be_field_inspector\` tinyint NOT NULL DEFAULT 0`);
        }

        if (!(await queryRunner.hasTable('field_inspection_requests'))) {
            await queryRunner.query(`CREATE TABLE \`field_inspection_requests\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`business_code\` varchar(20) NULL, \`property_id\` int NOT NULL, \`inspection_type\` varchar(100) NOT NULL, \`priority\` varchar(50) NOT NULL, \`description\` text NOT NULL, \`inspection_date\` date NOT NULL, \`assigned_to_user_id\` int NOT NULL, \`notify\` json NOT NULL, \`resolution_by\` date NOT NULL, \`notes\` text NULL, \`status\` enum ('requested') NOT NULL DEFAULT 'requested', \`requested_by_id\` int NULL, \`requested_on\` datetime NOT NULL, UNIQUE INDEX \`IDX_field_inspection_requests_business_code\` (\`business_code\`), INDEX \`IDX_field_inspection_requests_property\` (\`property_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        }

        if (!(await queryRunner.hasTable('field_inspection_request_readings'))) {
            await queryRunner.query(`CREATE TABLE \`field_inspection_request_readings\` (\`field_inspection_request_id\` int NOT NULL, \`meter_reading_id\` int NOT NULL, INDEX \`IDX_field_inspection_request_readings_request\` (\`field_inspection_request_id\`), INDEX \`IDX_field_inspection_request_readings_reading\` (\`meter_reading_id\`), PRIMARY KEY (\`field_inspection_request_id\`, \`meter_reading_id\`)) ENGINE=InnoDB`);
        }

        const addFkIfMissing = async (table: string, column: string, refTable: string, onDelete: 'SET NULL' | 'NO ACTION' | 'CASCADE') => {
            const existing = await queryRunner.query(
                `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?`,
                [table, column, refTable],
            );
            if (existing.length === 0) {
                await queryRunner.query(`ALTER TABLE \`${table}\` ADD FOREIGN KEY (\`${column}\`) REFERENCES \`${refTable}\`(\`id\`) ON DELETE ${onDelete} ON UPDATE NO ACTION`);
            }
        };

        await addFkIfMissing('field_inspection_requests', 'property_id', 'properties', 'NO ACTION');
        await addFkIfMissing('field_inspection_requests', 'assigned_to_user_id', 'users', 'NO ACTION');
        await addFkIfMissing('field_inspection_requests', 'requested_by_id', 'users', 'SET NULL');
        await addFkIfMissing('field_inspection_request_readings', 'field_inspection_request_id', 'field_inspection_requests', 'CASCADE');
        await addFkIfMissing('field_inspection_request_readings', 'meter_reading_id', 'meter_readings', 'CASCADE');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('field_inspection_request_readings')) {
            await queryRunner.query(`DROP TABLE \`field_inspection_request_readings\``);
        }
        if (await queryRunner.hasTable('field_inspection_requests')) {
            await queryRunner.query(`DROP TABLE \`field_inspection_requests\``);
        }
        const roleColumns = await queryRunner.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'can_be_field_inspector'`,
        );
        if (roleColumns.length > 0) {
            await queryRunner.query(`ALTER TABLE \`roles\` DROP COLUMN \`can_be_field_inspector\``);
        }
    }
}
