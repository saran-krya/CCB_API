import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the two tables of the account invitation system (docs/INVITATIONS_AND_EMAIL_TEMPLATES.md). It adds NO column to, and changes NO row of, any existing table, and creates no
 * foreign key (the invitation table refers to a staff user or a customer by `principal_type` + `principal_id`, the convention of
 * `refresh_tokens` and `user_devices`, because the two are separate id spaces).
 *
 *   account_invitations  one row per invited account (a staff user or a customer): who it is for, the address it was sent to, the SHA-256 of the
 *                        single-use token (never the token), the 24-hour expiry, the status (PENDING / ACCEPTED / EXPIRED / CANCELLED) and how the
 *                        last delivery went. At most one row per account (unique principal), and token hashes are unique.
 *   email_templates      the e-mail templates: one row per (template_key, locale), with the subject and the HTML body kept apart.
 *
 * NOT to be confused with `user_invitations`, the table the paused SaaS experiment left in the LOCAL development database: a different table with
 * a different shape (it carried the organization). This migration never reads, alters or drops it, and the invitation entity does not use that name.
 *
 * Idempotent against re-running (checks each table first), like this project's other hand-authored migrations: a table that is already there is
 * left exactly as it is. Order on a developer machine: TypeORM runs migrations FIRST and `synchronize` second (DataSource.initialize), so
 * this DDL creates the tables and synchronize then only compares them with the entities — which is why every column, default and index below is
 * kept identical to the entities (a difference would make synchronize ALTER the table on the next start).
 *
 * down() drops a table only while it is empty, so rolling back can never destroy invitation history or edited templates.
 */
export class CreateAccountInvitationsAndEmailTemplates1795600000000 implements MigrationInterface {
    name = 'CreateAccountInvitationsAndEmailTemplates1795600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('account_invitations'))) {
            await queryRunner.query(`
                CREATE TABLE \`account_invitations\` (
                    \`id\` int NOT NULL AUTO_INCREMENT,
                    \`principal_type\` varchar(10) NOT NULL,
                    \`principal_id\` int NOT NULL,
                    \`email\` varchar(160) NOT NULL,
                    \`recipient_name\` varchar(200) NOT NULL,
                    \`token_hash\` char(64) NOT NULL,
                    \`status\` varchar(10) NOT NULL DEFAULT 'PENDING',
                    \`expires_at\` datetime(6) NOT NULL,
                    \`accepted_at\` datetime(6) NULL,
                    \`cancelled_at\` datetime(6) NULL,
                    \`cancel_reason\` varchar(40) NULL,
                    \`expired_notified_at\` datetime(6) NULL,
                    \`sent_count\` int NOT NULL DEFAULT 0,
                    \`last_sent_at\` datetime(6) NULL,
                    \`last_send_error\` varchar(400) NULL,
                    \`created_by\` int NULL,
                    \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                    UNIQUE INDEX \`UQ_account_invitations_principal\` (\`principal_type\`, \`principal_id\`),
                    UNIQUE INDEX \`UQ_account_invitations_token_hash\` (\`token_hash\`),
                    INDEX \`IDX_account_invitations_status_expires\` (\`status\`, \`expires_at\`),
                    PRIMARY KEY (\`id\`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        }

        if (!(await queryRunner.hasTable('email_templates'))) {
            await queryRunner.query(`
                CREATE TABLE \`email_templates\` (
                    \`id\` int NOT NULL AUTO_INCREMENT,
                    \`template_key\` varchar(60) NOT NULL,
                    \`locale\` varchar(5) NOT NULL,
                    \`name\` varchar(120) NOT NULL,
                    \`subject\` varchar(300) NOT NULL,
                    \`body_html\` mediumtext NOT NULL,
                    \`body_text\` mediumtext NULL,
                    \`is_active\` tinyint NOT NULL DEFAULT 1,
                    \`is_system\` tinyint NOT NULL DEFAULT 0,
                    \`updated_by\` int NULL,
                    \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                    UNIQUE INDEX \`UQ_email_templates_key_locale\` (\`template_key\`, \`locale\`),
                    PRIMARY KEY (\`id\`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ['account_invitations', 'email_templates']) {
            if (!(await queryRunner.hasTable(table))) continue;

            const [{ row_count }] = await queryRunner.query(`SELECT COUNT(*) AS row_count FROM \`${table}\``);
            if (Number(row_count) > 0) {
                throw new Error(`Refusing to drop \`${table}\`: it holds ${row_count} row(s). Export or remove them deliberately first.`);
            }
            await queryRunner.query(`DROP TABLE \`${table}\``);
        }
    }
}
