import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Inline (role-attached) policies — the Role-level mirror of 1793600000000-AddUserInlinePolicies,
 * one level up. Pure additive schema, zero existing data touched. Creates the two new tables
 * (role_inline_policies, role_inline_policy_statements) alongside policies/policy_statements and
 * role_policies, which this migration does not alter in any way. Idempotent: every CREATE TABLE is
 * guarded by an information_schema existence check, safe to re-run.
 *
 * Fresh install: migrations run before `synchronize: true` does (see 1788342228029's own comment for
 * the confirmed cold-start evidence), so `roles`/`resources` don't exist yet when this runs — the same
 * situation 1793600000000 documented for `users`/`resources`. Safe to skip then: `synchronize` creates
 * both new tables (FKs included) directly from the current entity definitions right after migrations
 * finish.
 *
 * down() drops exactly the two tables this migration created, child before parent.
 */
export class AddRoleInlinePolicies1793700000000 implements MigrationInterface {
    name = 'AddRoleInlinePolicies1793700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const dbName = queryRunner.connection.options.database as string;

        const tableExists = async (tableName: string): Promise<boolean> => {
            const rows = await queryRunner.query(
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [dbName, tableName],
            );
            return rows.length > 0;
        };

        if (!(await tableExists('role_inline_policies')) && (await tableExists('roles'))) {
            await queryRunner.query(`
                CREATE TABLE role_inline_policies (
                    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    roleId INT NOT NULL,
                    name VARCHAR(150) NOT NULL,
                    description VARCHAR(500) NULL,
                    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                    deleted_at DATETIME(6) NULL,
                    UNIQUE KEY uq_role_inline_policies_role_name (roleId, name),
                    CONSTRAINT fk_role_inline_policies_role FOREIGN KEY (roleId) REFERENCES roles(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        }

        if (
            !(await tableExists('role_inline_policy_statements')) &&
            (await tableExists('role_inline_policies')) &&
            (await tableExists('resources'))
        ) {
            await queryRunner.query(`
                CREATE TABLE role_inline_policy_statements (
                    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    policyId INT NOT NULL,
                    resourceId INT NOT NULL,
                    effect VARCHAR(10) NOT NULL DEFAULT 'Allow',
                    actions JSON NOT NULL,
                    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                    deleted_at DATETIME(6) NULL,
                    CONSTRAINT fk_role_inline_policy_statements_policy FOREIGN KEY (policyId) REFERENCES role_inline_policies(id) ON DELETE CASCADE,
                    CONSTRAINT fk_role_inline_policy_statements_resource FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE RESTRICT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // FK-safe order: the child (referencing table) before its parent.
        await queryRunner.query(`DROP TABLE IF EXISTS role_inline_policy_statements`);
        await queryRunner.query(`DROP TABLE IF EXISTS role_inline_policies`);
    }
}
