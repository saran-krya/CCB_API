import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Removes direct Edit for Billing Cycle Configuration — explicit decision NOT to support editing an
 * existing billing cycle version directly. Configuration changes now only happen through the New
 * Version / Clone workflow (create -> modify -> submit -> Finance approval -> effective-date
 * activation), matching the maker-checker discipline every other approval flow in this app already
 * uses. The direct-edit endpoint (PATCH /billing-cycles/:id), its service method, and its DTO were
 * removed from the codebase in the same change.
 *
 * BILLING_CYCLE_NEW_VERSION and BILLING_CYCLE_DEPRECATE were parented under EDIT_BILLING_CYCLE for
 * display-tree grouping only (roleHasAction()/PermissionGuard check an action's own code directly —
 * parent/child nesting never affects real authorization). Both are re-parented to no parent (bare
 * top-level siblings of CREATE_BILLING_CYCLE/VIEW_BILLING_CYCLE) rather than reassigned to a
 * different parent, since neither is naturally a child of anything else on this screen.
 *
 * Soft-deletes the action (matches the established BILLING_ISSUE / BILLING_READINESS_PROPERTY_VIEW
 * removal pattern) rather than a hard delete — roleHasAction()'s real generated SQL joins actions
 * with "deleted_at IS NULL", so this alone removes it from both authorization and the RBAC admin
 * tree while preserving the historical row. Its one role_permissions row (SUPER_ADMIN, via admin
 * auto-grant) is deleted outright for hygiene.
 */
export class RemoveEditBillingCycle1790574566235 implements MigrationInterface {
    name = 'RemoveEditBillingCycle1790574566235'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const [action] = await queryRunner.query(
            `SELECT id FROM actions WHERE code = 'EDIT_BILLING_CYCLE' AND deleted_at IS NULL`,
        );
        if (!action) return;

        await queryRunner.query(
            `UPDATE actions SET parentActionId = NULL WHERE parentActionId = ?`,
            [action.id],
        );
        await queryRunner.query(
            `DELETE FROM role_permissions WHERE actionId = ?`,
            [action.id],
        );
        await queryRunner.query(
            `UPDATE actions SET deleted_at = NOW() WHERE id = ?`,
            [action.id],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Not reversed — direct Edit for Billing Cycle Configuration was intentionally discontinued,
        // not a mistake to roll back. A rollback would resurrect a permission code the app no longer
        // grants any endpoint for (its controller/service methods are gone), leaving a dangling grant.
    }
}
