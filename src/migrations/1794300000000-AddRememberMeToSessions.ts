import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Backs "Remember me" on sign-in. A session has to remember whether it was a remembered one, because that decides how
 * long its refresh token lives (REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN instead of REFRESH_TOKEN_EXPIRES_IN), whether the
 * refresh cookie is persistent or a browser-session cookie, and what Active Sessions shows. It cannot be worked out from
 * data that already exists (expires_at - created_at depends on configuration that can change), so each table that
 * carries a session gets one flag:
 *
 *   - refresh_tokens.remember_me  the session's own flag, copied from token to token on every rotation, so a remembered
 *                                 session stays remembered for as long as it keeps being refreshed;
 *   - user_devices.remember_me    the same flag for the device row Active Sessions lists (that row already mirrors the
 *                                 latest token's expires_at and refresh_token_hash, and now its remember_me too).
 *
 * NOT NULL DEFAULT 0: every existing session is correctly "not remembered" and keeps the expiry it already has. Nothing is
 * rewritten and no row is lost, so sessions that are signed in today carry on exactly as before.
 *
 * Idempotent against re-running (checks the table and the column first), matching this project's other hand-authored
 * migrations: on a developer machine `synchronize` can add the column from the entity as well, and on a fresh install the
 * tables do not exist yet when migrations run (synchronize / the baseline create them with the column already on them).
 */
const TABLES = ['refresh_tokens', 'user_devices'] as const;

export class AddRememberMeToSessions1794300000000 implements MigrationInterface {
    name = 'AddRememberMeToSessions1794300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const table of TABLES) {
            if (!(await queryRunner.hasTable(table))) continue;

            if (!(await queryRunner.hasColumn(table, 'remember_me'))) {
                await queryRunner.query(`ALTER TABLE \`${table}\` ADD \`remember_me\` tinyint NOT NULL DEFAULT 0`);
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of TABLES) {
            if (!(await queryRunner.hasTable(table))) continue;

            if (await queryRunner.hasColumn(table, 'remember_me')) {
                await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`remember_me\``);
            }
        }
    }
}
