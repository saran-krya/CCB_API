import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `user_roles` — the User -> Role mapping, replacing `users.role_id` as the RBAC source of
 * truth (see UserRole entity's own doc comment, and UserRoleService for the read/write paths that
 * now go through this table). `users.role_id` is deliberately NOT dropped — it stays in place,
 * unread by anything RBAC-relevant, since nothing in this change requires a destructive column
 * drop and keeping it costs nothing (see UserService.create/update, which now write BOTH
 * users.role_id and user_roles together so the two can never drift).
 *
 * Backfills one `user_roles` row per existing `users.role_id` value — every user keeps EXACTLY the
 * role they already had, so this migration changes no real RBAC behavior; it only re-plumbs where
 * that one fact is read from. A user with a NULL role_id (should not exist for any real account,
 * but `users.role_id` is nullable at the DB level) gets no backfilled row, matching
 * AuthService.login/refresh's own explicit "no role assigned" rejection for that case.
 *
 * Foreign keys added WITHOUT explicit CONSTRAINT names, matching this project's established
 * convention (AddFieldInspectionRequests/AddBillRunTables) to avoid a synchronize:true dev-setting
 * name collision. Idempotent against re-running.
 */
export class AddUserRolesTable1790840061000 implements MigrationInterface {
    name = 'AddUserRolesTable1790840061000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('user_roles'))) {
            await queryRunner.query(
                `CREATE TABLE \`user_roles\` (` +
                `\`id\` int NOT NULL AUTO_INCREMENT, ` +
                `\`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ` +
                `\`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), ` +
                `\`deleted_at\` datetime(6) NULL, ` +
                `\`user_id\` int NOT NULL, ` +
                `\`role_id\` int NOT NULL, ` +
                `UNIQUE INDEX \`IDX_user_roles_user_role\` (\`user_id\`, \`role_id\`), ` +
                `PRIMARY KEY (\`id\`)` +
                `) ENGINE=InnoDB`,
            );
        }

        const addFkIfMissing = async (column: string, refTable: string) => {
            const existing = await queryRunner.query(
                `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_roles' AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?`,
                [column, refTable],
            );
            if (existing.length === 0) {
                await queryRunner.query(`ALTER TABLE \`user_roles\` ADD FOREIGN KEY (\`${column}\`) REFERENCES \`${refTable}\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
            }
        };
        await addFkIfMissing('user_id', 'users');
        await addFkIfMissing('role_id', 'roles');

        // Backfill — one row per existing users.role_id, skipping any user already backfilled
        // (idempotent) and any user with a NULL role_id (none expected, handled anyway).
        await queryRunner.query(
            `INSERT INTO \`user_roles\` (\`user_id\`, \`role_id\`, \`created_at\`, \`updated_at\`)
             SELECT u.id, u.role_id, NOW(), NOW()
             FROM \`users\` u
             WHERE u.role_id IS NOT NULL
               AND u.deleted_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM \`user_roles\` ur WHERE ur.user_id = u.id AND ur.role_id = u.role_id
               )`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('user_roles')) {
            await queryRunner.query(`DROP TABLE \`user_roles\``);
        }
    }
}
