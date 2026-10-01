import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Renames the `pmodules` table to `modules`, per the RBAC schema update (User -> UserRole -> Role
 * -> RolePermission -> Module -> SubModule -> Screen -> Action). Table rename ONLY — the TypeScript
 * entity class stays `PModule` (see pmodule.entity.ts's own doc comment on why the class itself
 * was deliberately not renamed, to avoid an unnecessary, purely cosmetic change across the ~20
 * files that import it).
 *
 * `RENAME TABLE` in MySQL/InnoDB automatically carries every existing foreign key constraint and
 * index along with it — no FK/index needs to be dropped and recreated, and no other table's column
 * (`sub_modules.pModuleId`, `screens.pModuleId`, `role_permissions.moduleId`) needs to change, since
 * none of those are named after the TABLE, only after the (unchanged) relation. The one existing
 * migration that references the `pmodules` table name literally in raw SQL
 * (1790148200000-RehomeBillRunScreenToBillingManagement.ts) is a HISTORICAL, already-applied
 * migration and is deliberately left untouched — this migration runs strictly after it in sequence,
 * and editing an already-run migration file is unsafe.
 */
export class RenamePModulesToModules1790840048000 implements MigrationInterface {
    name = 'RenamePModulesToModules1790840048000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const hasOldTable = await queryRunner.hasTable('pmodules');
        const hasNewTable = await queryRunner.hasTable('modules');
        if (hasOldTable && !hasNewTable) {
            await queryRunner.query(`RENAME TABLE \`pmodules\` TO \`modules\``);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasOldTable = await queryRunner.hasTable('pmodules');
        const hasNewTable = await queryRunner.hasTable('modules');
        if (hasNewTable && !hasOldTable) {
            await queryRunner.query(`RENAME TABLE \`modules\` TO \`pmodules\``);
        }
    }
}
