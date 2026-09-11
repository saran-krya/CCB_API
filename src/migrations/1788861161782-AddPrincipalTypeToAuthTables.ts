import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `principal_type` ('staff' | 'customer') to refresh_tokens, user_devices and
 * user_login_history. Before this, `user_id` on these three tables was implicitly assumed to
 * always be a `users.id` — but customer login (added this session) issues sessions whose `sub` is
 * a `customers.id`, an entirely independent id space that can and does collide with `users.id`
 * (e.g. staff user 22 and customer 22 are unrelated rows). Every query against these tables must
 * now filter on (principal_type, user_id) together, never user_id alone, or a refresh/logout/
 * device-list call can silently act on the wrong principal's session — a real cross-tenant data
 * leak this migration closes.
 *
 * Defaults to 'staff' so every pre-existing row (all created before customer login existed) is
 * correctly backfilled without a separate UPDATE statement. Idempotent against re-running (checks
 * column existence first), matching this project's other hand-authored migrations.
 */
export class AddPrincipalTypeToAuthTables1788861161782 implements MigrationInterface {
    name = 'AddPrincipalTypeToAuthTables1788861161782'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('refresh_tokens', 'principal_type'))) {
            await queryRunner.query(`ALTER TABLE \`refresh_tokens\` ADD \`principal_type\` varchar(10) NOT NULL DEFAULT 'staff'`);
        }
        if (!(await queryRunner.hasColumn('user_devices', 'principal_type'))) {
            await queryRunner.query(`ALTER TABLE \`user_devices\` ADD \`principal_type\` varchar(10) NOT NULL DEFAULT 'staff'`);
        }
        if (!(await queryRunner.hasColumn('user_login_history', 'principal_type'))) {
            await queryRunner.query(`ALTER TABLE \`user_login_history\` ADD \`principal_type\` varchar(10) NOT NULL DEFAULT 'staff'`);
        }

        // user_devices' own (userId, deviceId) unique constraint must widen to include
        // principalType, or a staff user and a customer sharing the same numeric id and device
        // fingerprint could collide on insert.
        const oldUnique = await queryRunner.query(
            `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_devices' AND NON_UNIQUE = 0
               AND INDEX_NAME != 'PRIMARY'
               AND INDEX_NAME NOT IN (
                 SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_devices' AND COLUMN_NAME = 'principal_type'
               )`,
        );
        for (const row of oldUnique) {
            await queryRunner.query(`ALTER TABLE \`user_devices\` DROP INDEX \`${row.INDEX_NAME}\``);
        }
        const hasNewUnique = await queryRunner.query(
            `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_devices'
               AND COLUMN_NAME = 'principal_type' AND NON_UNIQUE = 0`,
        );
        if (hasNewUnique.length === 0) {
            await queryRunner.query(
                `ALTER TABLE \`user_devices\` ADD UNIQUE INDEX \`UQ_user_devices_principal_user_device\` (\`principal_type\`, \`user_id\`, \`device_id\`)`,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('refresh_tokens', 'principal_type')) {
            await queryRunner.query(`ALTER TABLE \`refresh_tokens\` DROP COLUMN \`principal_type\``);
        }
        if (await queryRunner.hasColumn('user_login_history', 'principal_type')) {
            await queryRunner.query(`ALTER TABLE \`user_login_history\` DROP COLUMN \`principal_type\``);
        }
        const newUnique = await queryRunner.query(
            `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_devices'
               AND COLUMN_NAME = 'principal_type' AND NON_UNIQUE = 0`,
        );
        for (const row of newUnique) {
            await queryRunner.query(`ALTER TABLE \`user_devices\` DROP INDEX \`${row.INDEX_NAME}\``);
        }
        if (await queryRunner.hasColumn('user_devices', 'principal_type')) {
            await queryRunner.query(`ALTER TABLE \`user_devices\` DROP COLUMN \`principal_type\``);
        }
        await queryRunner.query(`ALTER TABLE \`user_devices\` ADD UNIQUE INDEX \`UQ_user_devices_user_device\` (\`user_id\`, \`device_id\`)`);
    }
}
