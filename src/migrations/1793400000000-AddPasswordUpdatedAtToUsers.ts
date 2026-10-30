import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Backs the Security Credentials tab's "Sign-in access password: Updated N days ago" display — a
 * dedicated timestamp for password_hash changes only, distinct from BaseEntity's own
 * updated_at (which ticks on ANY column change, so it can't tell "password changed" from "name
 * edited"). Set by UserService.create/adminSetPasswordHash/clearPasswordHash and
 * AuthService.changePassword's existing self-service path — see those for the write sites. Every
 * existing row defaults to null, meaning "unknown / not tracked before this feature existed", which
 * is correct: there is no way to retroactively know when an existing user's password was last set.
 *
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations (see 1793200000000-AddMustChangePasswordToUsers.ts).
 */
export class AddPasswordUpdatedAtToUsers1793400000000 implements MigrationInterface {
    name = 'AddPasswordUpdatedAtToUsers1793400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fresh install: `users` doesn't exist yet (migrations run before `synchronize: true` does).
        // Safe to skip: synchronize creates `users` immediately after migrations finish, with this
        // column already on it from the current User entity definition.
        if (!(await queryRunner.hasTable('users'))) return;

        const hasColumn = await queryRunner.hasColumn('users', 'password_updated_at');
        if (!hasColumn) {
            await queryRunner.query(`ALTER TABLE \`users\` ADD \`password_updated_at\` timestamp NULL`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('users', 'password_updated_at');
        if (hasColumn) {
            await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`password_updated_at\``);
        }
    }
}
