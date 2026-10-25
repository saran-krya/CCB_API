import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Backs the Create User wizard's "Users must create a new password at next sign-in" checkbox
 * (AWS IAM-inspired) — set at creation time, checked once at the staff login path, cleared the
 * moment the user successfully changes their own password via the existing PATCH /auth/change-
 * password flow (AuthService.changePassword -> UserService.setPasswordHash). Every existing row
 * defaults to false, which is correct: no account created before this feature was ever meant to
 * force a password change.
 *
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations.
 */
export class AddMustChangePasswordToUsers1793200000000 implements MigrationInterface {
    name = 'AddMustChangePasswordToUsers1793200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fresh install: `users` doesn't exist yet (migrations run before `synchronize: true` does —
        // see 1788342228029-RefactorRegistrationRequestSchema's own comment for the confirmed
        // cold-start evidence). Safe to skip: synchronize creates `users` immediately after migrations
        // finish, with this column already on it from the current User entity definition.
        if (!(await queryRunner.hasTable('users'))) return;

        const hasColumn = await queryRunner.hasColumn('users', 'must_change_password');
        if (!hasColumn) {
            await queryRunner.query(`ALTER TABLE \`users\` ADD \`must_change_password\` tinyint NOT NULL DEFAULT 0`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('users', 'must_change_password');
        if (hasColumn) {
            await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`must_change_password\``);
        }
    }
}
