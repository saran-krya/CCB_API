import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * SaaS multi-tenancy, step 3 of the approved migration sequence — tracks a Tenant ADMIN invitation end
 * to end (see UserInvitation entity's own doc comment for the full design). Depends on both
 * `organizations` and `users` already existing; on a fresh install those (and this table) come from
 * `synchronize` directly, so this migration only matters when upgrading an existing database — same
 * skip-if-dependencies-missing posture as AddBillRunTables.
 */
export class CreateUserInvitationsTable1794600000000 implements MigrationInterface {
    name = 'CreateUserInvitationsTable1794600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('organizations')) || !(await queryRunner.hasTable('users'))) {
            return;
        }
        if (await queryRunner.hasTable('user_invitations')) return;

        await queryRunner.query(`CREATE TABLE \`user_invitations\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`organization_id\` int NOT NULL, \`user_id\` int NOT NULL, \`invited_email\` varchar(160) NOT NULL, \`token_hash\` varchar(128) NOT NULL, \`expires_at\` datetime NOT NULL, \`used_at\` datetime NULL, \`invited_by_id\` int NULL, UNIQUE INDEX \`IDX_user_invitations_token_hash\` (\`token_hash\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);

        const addFkIfMissing = async (column: string, refTable: string, onDelete: 'CASCADE' | 'SET NULL') => {
            const existing = await queryRunner.query(
                `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_invitations' AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?`,
                [column, refTable],
            );
            if (existing.length === 0) {
                await queryRunner.query(`ALTER TABLE \`user_invitations\` ADD FOREIGN KEY (\`${column}\`) REFERENCES \`${refTable}\`(\`id\`) ON DELETE ${onDelete} ON UPDATE NO ACTION`);
            }
        };

        await addFkIfMissing('organization_id', 'organizations', 'CASCADE');
        await addFkIfMissing('user_id', 'users', 'CASCADE');
        await addFkIfMissing('invited_by_id', 'users', 'SET NULL');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('user_invitations')) {
            await queryRunner.query(`DROP TABLE \`user_invitations\``);
        }
    }
}
