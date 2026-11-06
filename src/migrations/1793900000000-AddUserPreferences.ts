import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Personal preferences (Settings > Personal Settings) — pure additive schema, zero existing data touched. Creates the one
 * new table, `user_preferences` (one row per user, every preference nullable = "use the system default"). Theme,
 * navigation colour and language stay on `users`. Idempotent: guarded by an information_schema existence check. The
 * system-wide settings need no schema at all — they are SYSTEM attributes, backfilled by the attribute seed on boot, and
 * the two new lookup categories (TIMEZONE, DATE_FORMAT) are backfilled the same way. (`currency_code` is created but no
 * longer used: the currency is the single Default Currency attribute, so no personal currency is offered.)
 *
 * down() drops exactly the table this migration created.
 */
export class AddUserPreferences1793900000000 implements MigrationInterface {
    name = 'AddUserPreferences1793900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const dbName = queryRunner.connection.options.database as string;
        const rows = await queryRunner.query(
            `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [dbName, 'user_preferences'],
        );
        if (rows.length > 0) return;

        await queryRunner.query(`
            CREATE TABLE user_preferences (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                timezone VARCHAR(64) NULL,
                date_format VARCHAR(20) NULL,
                currency_code VARCHAR(10) NULL,
                sidebar_state VARCHAR(12) NULL,
                table_density VARCHAR(12) NULL,
                default_page_size INT NULL,
                notification_preferences JSON NULL,
                created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                deleted_at DATETIME(6) NULL,
                UNIQUE KEY uq_user_preferences_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS user_preferences`);
    }
}
