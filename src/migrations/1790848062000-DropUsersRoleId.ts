import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Removes `users.role_id` — `user_roles` is now the ONLY source of truth for a user's role (see
 * UserRole entity's own doc comment). Every consumer that read `user.role`/`user.roleId` has
 * already been migrated to go through UserRoleService, including the non-RBAC business lookups
 * (Field Inspection eligibility, Reporting Manager/Field Inspector pickers, the Users dashboard) —
 * see that service's own doc comment for the full list.
 *
 * Before this migration runs, every existing non-null `users.role_id` must already have a matching
 * `user_roles` row — `AddUserRolesTable1790840061000` backfilled this for every user that existed at
 * that migration's run time. This migration does NOT re-verify that backfill itself (it has no way
 * to, since `up()` tolerates `role_id` already being gone — see below); that verification was done
 * manually against the live dev database before this migration was written, including reconciling 3
 * users created after the backfill ran whose original role had since been hard-deleted (no
 * `deleted_at` trace) — those 3 were assigned a documented safe-default (zero-permission) role and
 * flagged for manual review, since their exact original role could not be recovered.
 *
 * `up()` tolerates the column already being absent: `synchronize: true` (dev-only) can auto-drop a
 * column the moment its entity decorator is removed, on whatever `nest start --watch` reboot happens
 * to run next — same idempotent-by-hasColumn-check convention as every other migration in this
 * project, just on the defensive side (column-already-gone) rather than the usual
 * column-already-added side.
 */
export class DropUsersRoleId1790848062000 implements MigrationInterface {
    name = 'DropUsersRoleId1790848062000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('users', 'role_id');
        if (!hasColumn) return;

        const fks = await queryRunner.query(
            `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role_id' AND REFERENCED_TABLE_NAME IS NOT NULL`,
        );
        for (const fk of fks) {
            await queryRunner.query(`ALTER TABLE \`users\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
        }

        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`role_id\``);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('users', 'role_id');
        if (hasColumn) return;

        await queryRunner.query(`ALTER TABLE \`users\` ADD \`role_id\` int NULL`);

        const existing = await queryRunner.query(
            `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role_id' AND REFERENCED_TABLE_NAME = 'roles'`,
        );
        if (existing.length === 0) {
            await queryRunner.query(`ALTER TABLE \`users\` ADD FOREIGN KEY (\`role_id\`) REFERENCES \`roles\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        }

        // Best-effort repopulation from user_roles (the inverse of AddUserRolesTable's own
        // backfill) — restores each user's primary role id so a down-migration leaves the column
        // populated, not silently NULL for every row.
        await queryRunner.query(
            `UPDATE \`users\` u
             INNER JOIN (
               SELECT user_id, MIN(id) AS first_id
               FROM \`user_roles\`
               WHERE deleted_at IS NULL
               GROUP BY user_id
             ) first_ur ON first_ur.user_id = u.id
             INNER JOIN \`user_roles\` ur ON ur.id = first_ur.first_id
             SET u.role_id = ur.role_id`,
        );
    }
}
