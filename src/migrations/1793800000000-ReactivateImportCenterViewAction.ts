import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * `IMPORT_CENTER_VIEW` is a seeded, catalogued permission (seed-data.ts ACTIONS, the IMPORT_CENTER
 * Resource in resource-catalog.ts) that real routes require (GET meters/import-center and its sibling) and
 * that the sidebar's NAV_PERMISSION_MAP maps IMPORT_CENTER to. In at least one environment its row was
 * found switched to `isActive = 0`. The Policy editor and IamService.validateStatements only ever offer and
 * accept ACTIVE actions, so with the row inactive no Policy could grant Import Center to any role — only
 * SUPER_ADMIN (whose system Policy already held the code) could use it.
 *
 * Nothing in the codebase deactivates it, so the flag was flipped through the Actions admin API; that path
 * is now closed (ActionsService refuses to deactivate, rename or delete a system action). This migration
 * repairs the data: it flips `isActive` back to 1 for that ONE code, only where it is currently 0 and the
 * row is not deleted — so it is a no-op on a healthy database, safe to re-run, and touches nothing else
 * (no other action, no policy, no grant). `down()` is deliberately empty: the previous state was a defect,
 * and there is no way to know what a given environment had before.
 */
export class ReactivateImportCenterViewAction1793800000000 implements MigrationInterface {
    name = 'ReactivateImportCenterViewAction1793800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fresh install: `actions` is created by synchronize/seed after migrations run — nothing to repair.
        if (!(await queryRunner.hasTable('actions'))) return;

        await queryRunner.query(
            "UPDATE `actions` SET `isActive` = 1 WHERE `code` = 'IMPORT_CENTER_VIEW' AND `isActive` = 0 AND `deleted_at` IS NULL",
        );
    }

    public async down(): Promise<void> {
        // Intentionally empty — see the class comment.
    }
}
