import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Collapses Billing Readiness's 4 tab-equivalent Screen rows (Dashboard, Property Billing
 * Readiness, Anomaly Review, Readings List) down to the ONE real screen the sub-module already
 * matches 1:1 (BILLING_READINESS) — mirroring how Meter Information (METER_LIST screen ==
 * METER_LIST sub-module) already models a screen with multiple sibling actions.
 *
 * The 4 tabs are pure UI navigation, not independent RBAC boundaries. Two of the four screens
 * (Anomaly Review, Readings List) had ZERO actions attached — nothing to grant — yet
 * RolePermissionsService.updateRolePermissions() would still persist a bare screenId-only
 * role_permissions row (no actionId) if an admin checked either in the Roles UI: inert only because
 * usePermission() never reads screen-level hasAccess, but a real structural landmine.
 *
 * This migration:
 * 1. Re-points BILLING_READINESS_PROPERTY_VIEW's action row from the doomed
 *    BILLING_READINESS_PROPERTY screen onto the surviving BILLING_READINESS screen, as a sibling of
 *    BILLING_READINESS_VIEW.
 * 2. Deletes the 3 now-obsolete screen rows (BILLING_READINESS_PROPERTY,
 *    BILLING_READINESS_ANOMALY_REVIEW, BILLING_READINESS_READINGS_LIST).
 * 3. Renames the surviving screen from "Dashboard" to "Billing Readiness" (it now represents the
 *    whole area, not just one tab).
 *
 * IMPORTANT — step 2's DELETE cascades via Screen's onDelete: 'CASCADE' relation on
 * role_permissions.screenId, which would silently wipe any role_permissions row still pointing at
 * BILLING_READINESS_PROPERTY (id 34 in the environment this was authored against) — including ones
 * whose real authorization content is the actionId, not the screenId. Step 1 (re-pointing the
 * action BEFORE the delete) prevents this for the one row that matters; this migration additionally
 * re-creates any grant that already existed for BILLING_READINESS_PROPERTY_VIEW under the OLD
 * screenId, re-pointed onto the new screenId, as a defensive backstop against exactly that class of
 * data loss (confirmed hit once during manual testing of this exact change — see this migration's
 * own history).
 *
 * No new permission/action codes are introduced. BILLING_READINESS_VIEW and
 * BILLING_READINESS_PROPERTY_VIEW keep their ids and codes unchanged; only which screen they attach
 * to changes. roleHasAction() joins solely on actionId/action.code, so no existing role's actual
 * authorization changes as a result of this migration — only where these actions appear in the RBAC
 * admin tree does.
 */
export class CollapseBillingReadinessTabScreens1790156921957 implements MigrationInterface {
    name = 'CollapseBillingReadinessTabScreens1790156921957'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const [survivingScreen] = await queryRunner.query(
            `SELECT id FROM screens WHERE code = 'BILLING_READINESS'`,
        );
        if (!survivingScreen) return; // Bootstrap hasn't run yet in this environment — nothing to migrate.

        const [propertyScreen] = await queryRunner.query(
            `SELECT id FROM screens WHERE code = 'BILLING_READINESS_PROPERTY'`,
        );

        if (propertyScreen) {
            // Snapshot any role_permissions rows on the doomed screen keyed by actionId (real grants,
            // not bare screenId-only rows) so they can be re-created under the new screenId if the
            // CASCADE delete below removes them before the re-point below takes effect in this same
            // transaction's view of the data.
            const grantsToPreserve = await queryRunner.query(
                `SELECT DISTINCT roleId, moduleId, subModuleId, actionId FROM role_permissions
                 WHERE screenId = ? AND actionId IS NOT NULL`,
                [propertyScreen.id],
            );

            await queryRunner.query(
                `UPDATE actions SET screenId = ? WHERE code = 'BILLING_READINESS_PROPERTY_VIEW'`,
                [survivingScreen.id],
            );

            await queryRunner.query(
                `DELETE FROM screens WHERE code IN ('BILLING_READINESS_PROPERTY', 'BILLING_READINESS_ANOMALY_REVIEW', 'BILLING_READINESS_READINGS_LIST')`,
            );

            for (const g of grantsToPreserve) {
                const [existing] = await queryRunner.query(
                    `SELECT id FROM role_permissions WHERE roleId = ? AND actionId = ? AND deleted_at IS NULL`,
                    [g.roleId, g.actionId],
                );
                if (!existing) {
                    await queryRunner.query(
                        `INSERT INTO role_permissions (roleId, moduleId, subModuleId, screenId, actionId, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
                        [g.roleId, g.moduleId, g.subModuleId, survivingScreen.id, g.actionId],
                    );
                }
            }
        } else {
            await queryRunner.query(
                `UPDATE actions SET screenId = ? WHERE code = 'BILLING_READINESS_PROPERTY_VIEW'`,
                [survivingScreen.id],
            );
            await queryRunner.query(
                `DELETE FROM screens WHERE code IN ('BILLING_READINESS_ANOMALY_REVIEW', 'BILLING_READINESS_READINGS_LIST')`,
            );
        }

        await queryRunner.query(
            `UPDATE screens SET name = 'Billing Readiness' WHERE code = 'BILLING_READINESS'`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Not reversed — the prior 4-screen structure was the bug being fixed, not a state worth
        // restoring. A rollback would recreate the exact landmine this migration removes.
    }
}
