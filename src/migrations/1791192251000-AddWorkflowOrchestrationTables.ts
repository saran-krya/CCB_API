import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the real Workflow orchestration tables — `workflow_definitions`, `workflow_definition_levels`,
 * `workflow_instances`, `workflow_instance_steps` — implementing the approved architecture design
 * (see `WORKFLOW_ARCHITECTURE_DESIGN.md`). These supersede the old advisory-only
 * `workflow_approval_levels` table FUNCTIONALLY, but that table is deliberately NOT dropped or
 * migrated by this migration — see the data-migration note at the bottom of this file. Dropping it
 * here would be an irreversible, silent loss of whatever advisory configuration already exists; the
 * backfill into `workflow_definitions`/`workflow_definition_levels` is a separate, explicit, reviewed
 * step (run via a one-off script, not a blind schema migration) per the approved design's migration
 * strategy (§P).
 *
 * All four tables follow this project's established idempotent-migration convention
 * (hasTable/hasColumn checks, FKs added without explicit constraint names to avoid a
 * synchronize:true dev-setting name collision, matching down() methods).
 */
export class AddWorkflowOrchestrationTables1791192251000 implements MigrationInterface {
    name = 'AddWorkflowOrchestrationTables1791192251000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fresh install: `roles`/`users` don't exist yet (migrations run before `synchronize: true`
        // does — see 1788342228029's own comment for the confirmed cold-start evidence), which
        // would fail the FKs added further down outright. Safe to skip entirely: `synchronize`
        // creates all four workflow orchestration tables (FKs included) directly from their current
        // entity definitions right after migrations finish.
        if (!(await queryRunner.hasTable('roles')) || !(await queryRunner.hasTable('users'))) return;

        // ── workflow_definitions ──
        if (!(await queryRunner.hasTable('workflow_definitions'))) {
            await queryRunner.query(
                `CREATE TABLE \`workflow_definitions\` (` +
                `\`id\` int NOT NULL AUTO_INCREMENT, ` +
                `\`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ` +
                `\`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), ` +
                `\`deleted_at\` datetime(6) NULL, ` +
                `\`workflowType\` varchar(20) NOT NULL, ` +
                `\`version\` int NOT NULL, ` +
                `\`status\` varchar(10) NOT NULL DEFAULT 'ACTIVE', ` +
                `\`createdBy\` int NULL, ` +
                `INDEX \`IDX_workflow_definitions_type_status\` (\`workflowType\`, \`status\`), ` +
                `PRIMARY KEY (\`id\`)` +
                `) ENGINE=InnoDB`,
            );
        }

        // ── workflow_definition_levels ──
        if (!(await queryRunner.hasTable('workflow_definition_levels'))) {
            await queryRunner.query(
                `CREATE TABLE \`workflow_definition_levels\` (` +
                `\`id\` int NOT NULL AUTO_INCREMENT, ` +
                `\`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ` +
                `\`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), ` +
                `\`deleted_at\` datetime(6) NULL, ` +
                `\`definitionId\` int NOT NULL, ` +
                `\`levelOrder\` int NOT NULL, ` +
                `\`roleId\` int NOT NULL, ` +
                `\`department\` varchar(30) NULL, ` +
                `\`slaValue\` int NOT NULL, ` +
                `\`slaUnit\` varchar(20) NOT NULL, ` +
                `\`onBreach\` varchar(20) NOT NULL, ` +
                `INDEX \`IDX_workflow_definition_levels_def_order\` (\`definitionId\`, \`levelOrder\`), ` +
                `PRIMARY KEY (\`id\`)` +
                `) ENGINE=InnoDB`,
            );
        }

        // ── workflow_instances ──
        if (!(await queryRunner.hasTable('workflow_instances'))) {
            await queryRunner.query(
                `CREATE TABLE \`workflow_instances\` (` +
                `\`id\` int NOT NULL AUTO_INCREMENT, ` +
                `\`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ` +
                `\`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), ` +
                `\`deleted_at\` datetime(6) NULL, ` +
                `\`workflowType\` varchar(20) NOT NULL, ` +
                `\`businessObjectId\` int NOT NULL, ` +
                `\`definitionId\` int NOT NULL, ` +
                `\`currentLevelOrder\` int NULL, ` +
                `\`status\` varchar(20) NOT NULL DEFAULT 'WAITING_FOR_APPROVAL', ` +
                `\`submittedById\` int NULL, ` +
                `\`submittedAt\` datetime(6) NOT NULL, ` +
                `\`completedAt\` datetime(6) NULL, ` +
                `INDEX \`IDX_workflow_instances_type_object_status\` (\`workflowType\`, \`businessObjectId\`, \`status\`), ` +
                `PRIMARY KEY (\`id\`)` +
                `) ENGINE=InnoDB`,
            );
        }

        // ── workflow_instance_steps ──
        if (!(await queryRunner.hasTable('workflow_instance_steps'))) {
            await queryRunner.query(
                `CREATE TABLE \`workflow_instance_steps\` (` +
                `\`id\` int NOT NULL AUTO_INCREMENT, ` +
                `\`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ` +
                `\`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), ` +
                `\`deleted_at\` datetime(6) NULL, ` +
                `\`instanceId\` int NOT NULL, ` +
                `\`levelOrder\` int NOT NULL, ` +
                `\`roleId\` int NOT NULL, ` +
                `\`slaValue\` int NOT NULL, ` +
                `\`slaUnit\` varchar(20) NOT NULL, ` +
                `\`activatedAt\` datetime(6) NOT NULL, ` +
                `\`slaDueAt\` datetime(6) NULL, ` +
                `\`slaBreachedAt\` datetime(6) NULL, ` +
                `\`actedById\` int NULL, ` +
                `\`action\` varchar(20) NULL, ` +
                `\`actedAt\` datetime(6) NULL, ` +
                `\`notes\` text NULL, ` +
                `INDEX \`IDX_workflow_instance_steps_instance_order\` (\`instanceId\`, \`levelOrder\`), ` +
                `INDEX \`IDX_workflow_instance_steps_sla_due\` (\`slaDueAt\`), ` +
                `PRIMARY KEY (\`id\`)` +
                `) ENGINE=InnoDB`,
            );
        }

        // ── Foreign keys — added without explicit constraint names (existing project convention) ──
        const addFkIfMissing = async (table: string, column: string, refTable: string, onDelete: string) => {
            const existing = await queryRunner.query(
                `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?`,
                [table, column, refTable],
            );
            if (existing.length === 0) {
                await queryRunner.query(`ALTER TABLE \`${table}\` ADD FOREIGN KEY (\`${column}\`) REFERENCES \`${refTable}\`(\`id\`) ON DELETE ${onDelete} ON UPDATE NO ACTION`);
            }
        };

        await addFkIfMissing('workflow_definition_levels', 'definitionId', 'workflow_definitions', 'CASCADE');
        await addFkIfMissing('workflow_definition_levels', 'roleId', 'roles', 'CASCADE');
        await addFkIfMissing('workflow_instances', 'definitionId', 'workflow_definitions', 'RESTRICT');
        await addFkIfMissing('workflow_instances', 'submittedById', 'users', 'SET NULL');
        await addFkIfMissing('workflow_instance_steps', 'instanceId', 'workflow_instances', 'CASCADE');
        await addFkIfMissing('workflow_instance_steps', 'roleId', 'roles', 'RESTRICT');
        await addFkIfMissing('workflow_instance_steps', 'actedById', 'users', 'SET NULL');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('workflow_instance_steps')) {
            await queryRunner.query(`DROP TABLE \`workflow_instance_steps\``);
        }
        if (await queryRunner.hasTable('workflow_instances')) {
            await queryRunner.query(`DROP TABLE \`workflow_instances\``);
        }
        if (await queryRunner.hasTable('workflow_definition_levels')) {
            await queryRunner.query(`DROP TABLE \`workflow_definition_levels\``);
        }
        if (await queryRunner.hasTable('workflow_definitions')) {
            await queryRunner.query(`DROP TABLE \`workflow_definitions\``);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DATA MIGRATION NOTE (not performed by this schema migration — see approved design §P):
// Any existing rows in `workflow_approval_levels` (the old advisory table) represent configuration
// someone may have already entered via the Workflow UI. Before this orchestration engine is
// actually relied upon for a given workflowType, run the one-off backfill described in the
// architecture design: for each distinct workflowType with rows in `workflow_approval_levels`,
// create one `workflow_definitions` row (version=1, status=ACTIVE) and copy each level's
// role/department/SLA/breach into a matching `workflow_definition_levels` row, preserving
// levelOrder exactly. This is deliberately a separate, explicit, human-reviewed step — never
// silently invented or run automatically by a schema migration.
// ─────────────────────────────────────────────────────────────────────────────────────────────
