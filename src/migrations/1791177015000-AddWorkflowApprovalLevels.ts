import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `workflow_approval_levels` — reproduces CCB_Template's Business Admin -> Workflow Management
 * -> Approval Workflows edit-mode policy exactly (role, department scope, SLA, on-breach behavior,
 * multiple ordered levels per process). See WorkflowApprovalLevel entity's own doc comment: this is
 * a POLICY RECORD ONLY, deliberately decoupled from the real approve permission in
 * `role_permissions` (TARIFF_APPROVE / TARIFF_APPROVAL_APPROVE / BILL_RUN_APPROVE, written by
 * WorkflowService.setApprovers) — saving a level here grants nothing and gates nothing.
 *
 * No backfill/seed: a workflow type with zero rows here means "no policy recorded yet", which the
 * API surfaces honestly (matching the Template's own `workflow === null` / `notFound` contract)
 * rather than inventing a default policy nobody configured.
 *
 * Foreign key added WITHOUT an explicit CONSTRAINT name, matching this project's established
 * convention (AddUserRolesTable and others) to avoid a synchronize:true dev-setting name collision.
 * Idempotent against re-running.
 */
export class AddWorkflowApprovalLevels1791177015000 implements MigrationInterface {
    name = 'AddWorkflowApprovalLevels1791177015000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('workflow_approval_levels'))) {
            await queryRunner.query(
                `CREATE TABLE \`workflow_approval_levels\` (` +
                `\`id\` int NOT NULL AUTO_INCREMENT, ` +
                `\`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ` +
                `\`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), ` +
                `\`deleted_at\` datetime(6) NULL, ` +
                `\`workflowType\` varchar(20) NOT NULL, ` +
                `\`levelOrder\` int NOT NULL, ` +
                `\`roleId\` int NOT NULL, ` +
                `\`department\` varchar(30) NULL, ` +
                `\`slaValue\` int NOT NULL, ` +
                `\`slaUnit\` varchar(20) NOT NULL, ` +
                `\`onBreach\` varchar(20) NOT NULL, ` +
                `INDEX \`IDX_workflow_approval_levels_type_order\` (\`workflowType\`, \`levelOrder\`), ` +
                `PRIMARY KEY (\`id\`)` +
                `) ENGINE=InnoDB`,
            );
        }

        const existingFk = await queryRunner.query(
            `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workflow_approval_levels' AND COLUMN_NAME = 'roleId' AND REFERENCED_TABLE_NAME = 'roles'`,
        );
        if (existingFk.length === 0) {
            await queryRunner.query(`ALTER TABLE \`workflow_approval_levels\` ADD FOREIGN KEY (\`roleId\`) REFERENCES \`roles\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('workflow_approval_levels')) {
            await queryRunner.query(`DROP TABLE \`workflow_approval_levels\``);
        }
    }
}
