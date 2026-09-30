import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Re-homes the existing "Bill Run" screen (code BILLING_READINESS_BILL_RUN) from
 * Meter Management → Billing Readiness into Billing Management's new Bill Run Register
 * sub-module — Finance's approve/reject/return workflow moves there; the Billing Readiness tab of
 * the same name stays visible but becomes view-only (frontend-only change, no RBAC/action impact).
 *
 * This is a pure re-nest for navigation/RBAC-tree display: BILL_RUN_VIEW/SUBMIT/APPROVE keep their
 * ids and codes unchanged, and `RolePermissionsService.roleHasAction()` (the sole real backend
 * authorization check) joins only on `actionId`/`action.code` — it never reads a role_permission
 * row's denormalized moduleId/subModuleId/screenId. No existing grant's actual authorization
 * changes as a result of this migration; only where the screen appears in the permission tree does.
 *
 * `ensureCriticalDefaults()` (ScreensService/SubModulesService) only backfills rows that don't
 * exist yet — it never retroactively moves an existing screen's sub-module, so this data fix-up is
 * a real migration, not something bootstrap would apply on its own. Depends on the
 * BILL_RUN_REGISTER sub-module already existing (created by SubModulesService.ensureCriticalDefaults
 * on boot, from the seed-data.ts entry added alongside this change) — if it hasn't run yet in a
 * given environment, this migration creates it directly rather than failing.
 */
export class RehomeBillRunScreenToBillingManagement1790148200000 implements MigrationInterface {
    name = 'RehomeBillRunScreenToBillingManagement1790148200000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        let [registerSubModule] = await queryRunner.query(
            `SELECT id FROM sub_modules WHERE code = 'BILL_RUN_REGISTER'`,
        );

        if (!registerSubModule) {
            const [billingManagement] = await queryRunner.query(
                `SELECT id FROM pmodules WHERE code = 'BILLING_MANAGEMENT'`,
            );
            if (!billingManagement) {
                // BILLING_MANAGEMENT itself doesn't exist yet in this environment (bootstrap hasn't run
                // at all) — nothing to re-home onto; bootstrap will create everything correctly on next
                // boot from the current seed-data.ts, so this migration has nothing to do here.
                return;
            }
            await queryRunner.query(
                `INSERT INTO sub_modules (pModuleId, name, code, icon, url, displayOrder, isActive, created_at, updated_at) VALUES (?, 'Bill Run Register', 'BILL_RUN_REGISTER', 'ClipboardCheck', '/billing/bill-run-register', 6, 1, NOW(), NOW())`,
                [billingManagement.id],
            );
            [registerSubModule] = await queryRunner.query(
                `SELECT id FROM sub_modules WHERE code = 'BILL_RUN_REGISTER'`,
            );
        }

        await queryRunner.query(
            `UPDATE screens SET subModuleId = ?, name = 'Bill Run Register', url = '/billing/bill-run-register' WHERE code = 'BILLING_READINESS_BILL_RUN'`,
            [registerSubModule.id],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const [billingReadiness] = await queryRunner.query(
            `SELECT id FROM sub_modules WHERE code = 'BILLING_READINESS'`,
        );
        if (!billingReadiness) return;

        await queryRunner.query(
            `UPDATE screens SET subModuleId = ?, name = 'Bill Run Request', url = '/meters/billing-readiness/bill-run' WHERE code = 'BILLING_READINESS_BILL_RUN'`,
            [billingReadiness.id],
        );
    }
}
