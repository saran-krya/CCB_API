import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Merges BILLING_READINESS_PROPERTY_VIEW into BILLING_READINESS_VIEW — explicit request that
 * Billing Readiness expose exactly ONE user-facing "View" permission for the whole sub-module,
 * with every tab (Dashboard, Property Billing Readiness, Anomaly Review, Readings List) deriving
 * visibility from it alone, rather than two independently-assignable view-only codes.
 *
 * Confirmed safe via a live grants audit before this migration was authored: every role that held
 * BILLING_READINESS_PROPERTY_VIEW (SUPER_ADMIN, CUSTOMER_SERVICE_EXECUTIVE) already independently
 * held BILLING_READINESS_VIEW too — zero roles held ONLY the property code, so no role loses access.
 *
 * Soft-deletes the action (matches the established BILLING_ISSUE removal pattern earlier in this
 * codebase) rather than a hard delete — roleHasAction()'s real generated SQL joins actions with
 * "deleted_at IS NULL", so this alone removes it from both authorization and the RBAC admin tree
 * while preserving the historical row. Its role_permissions rows are deleted outright for hygiene.
 *
 * The 3 real backend call sites that previously OR'd both codes together (billing-readiness
 * .controller.ts, field-inspection.controller.ts's FIELD_INSPECTION_ACCESS constant, user
 * .controller.ts's field-inspectors endpoint) were updated in the same change to require only
 * BILLING_READINESS_VIEW — no endpoint loses its access boundary, since holding the surviving code
 * was already necessary for every real grant.
 */
export class RemoveBillingReadinessPropertyView1790159558469 implements MigrationInterface {
    name = 'RemoveBillingReadinessPropertyView1790159558469'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const [action] = await queryRunner.query(
            `SELECT id FROM actions WHERE code = 'BILLING_READINESS_PROPERTY_VIEW' AND deleted_at IS NULL`,
        );
        if (!action) return;

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
        // Not reversed — the two-code split was the state being corrected, not one worth restoring.
        // A rollback would recreate the exact ambiguity ("two separate View permissions for one
        // sub-module") this migration exists to remove.
    }
}
