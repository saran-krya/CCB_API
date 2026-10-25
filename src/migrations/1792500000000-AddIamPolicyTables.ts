import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 2 of the AWS IAM-inspired RBAC evolution — pure additive schema, zero existing data touched.
 * Creates the four new tables (resources, policies, policy_statements, role_policies) that sit
 * ALONGSIDE the existing roles/role_permissions/actions/screens/sub_modules/modules tables, which
 * this migration does not alter in any way. Idempotent: every CREATE TABLE is guarded by an
 * information_schema existence check, safe to re-run.
 *
 * down() drops exactly the four tables this migration created, in FK-safe order (children before
 * parents) — never touches any pre-existing table.
 */
export class AddIamPolicyTables1792500000000 implements MigrationInterface {
    name = 'AddIamPolicyTables1792500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const dbName = queryRunner.connection.options.database as string;

        const tableExists = async (tableName: string): Promise<boolean> => {
            const rows = await queryRunner.query(
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [dbName, tableName],
            );
            return rows.length > 0;
        };

        if (!(await tableExists('resources'))) {
            await queryRunner.query(`
                CREATE TABLE resources (
                    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    code VARCHAR(100) NOT NULL UNIQUE,
                    name VARCHAR(255) NOT NULL,
                    description VARCHAR(500) NULL,
                    parentResourceId INT NULL,
                    displayOrder INT NOT NULL DEFAULT 0,
                    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                    deleted_at DATETIME(6) NULL,
                    CONSTRAINT fk_resources_parent FOREIGN KEY (parentResourceId) REFERENCES resources(id) ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        }

        if (!(await tableExists('policies'))) {
            await queryRunner.query(`
                CREATE TABLE policies (
                    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(150) NOT NULL UNIQUE,
                    description VARCHAR(500) NULL,
                    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                    deleted_at DATETIME(6) NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        }

        if (!(await tableExists('policy_statements'))) {
            await queryRunner.query(`
                CREATE TABLE policy_statements (
                    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    policyId INT NOT NULL,
                    resourceId INT NOT NULL,
                    effect VARCHAR(10) NOT NULL DEFAULT 'Allow',
                    actions JSON NOT NULL,
                    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                    deleted_at DATETIME(6) NULL,
                    CONSTRAINT fk_policy_statements_policy FOREIGN KEY (policyId) REFERENCES policies(id) ON DELETE CASCADE,
                    CONSTRAINT fk_policy_statements_resource FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE RESTRICT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        }

        // Fresh install: `roles` doesn't exist yet (migrations run before `synchronize: true` does —
        // see 1788342228029's own comment for the confirmed cold-start evidence), which would fail
        // role_policies' own inline FK (REFERENCES roles(id)) outright, even though `resources`/
        // `policies`/`policy_statements` above have no such dependency and are always safe to
        // create. Safe to skip only this one table here: `synchronize` creates `role_policies` (FK
        // included) directly from the current RolePolicy entity definition right after migrations finish.
        if (!(await tableExists('role_policies')) && (await tableExists('roles'))) {
            await queryRunner.query(`
                CREATE TABLE role_policies (
                    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    roleId INT NOT NULL,
                    policyId INT NOT NULL,
                    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                    deleted_at DATETIME(6) NULL,
                    UNIQUE KEY uq_role_policies_role_policy (roleId, policyId),
                    CONSTRAINT fk_role_policies_role FOREIGN KEY (roleId) REFERENCES roles(id) ON DELETE CASCADE,
                    CONSTRAINT fk_role_policies_policy FOREIGN KEY (policyId) REFERENCES policies(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // FK-safe order: children (referencing tables) before parents.
        await queryRunner.query(`DROP TABLE IF EXISTS role_policies`);
        await queryRunner.query(`DROP TABLE IF EXISTS policy_statements`);
        await queryRunner.query(`DROP TABLE IF EXISTS policies`);
        await queryRunner.query(`DROP TABLE IF EXISTS resources`);
    }
}
