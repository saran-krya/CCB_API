import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Moves BILL_RUN_SUBMIT ("Run Billing") from the BILLING_READINESS_BILL_RUN screen (nested under
 * Billing Management's Bill Run Register — Finance's review UI) onto the BILLING_READINESS screen
 * (Meter Management side) instead, as a sibling of BILLING_READINESS_VIEW — explicit request that
 * "Run Billing" appear under Meter Management → Billing Readiness in the Roles UI, giving the final
 * target structure:
 *
 *   Billing Readiness
 *   ├── View
 *   └── Run Billing
 *
 * BILL_RUN_VIEW and BILL_RUN_APPROVE stay exactly where they are (Bill Run Register / Finance
 * review) — only Submit moves. Also clears parentActionId (was BILL_RUN_VIEW) since View and Run
 * Billing no longer share a screen — ActionsService.assertValidParent requires a parent/child pair
 * to share one screen, so Run Billing becomes an unparented sibling of BILLING_READINESS_VIEW
 * instead, matching the target sibling structure.
 *
 * IMPORTANT — this migration exists because a prior attempt to move this action via a raw DB write
 * alone was silently reverted on the next app boot: ActionsService.ensureCriticalDefaults()'s
 * correction pass re-applies seed-data.ts's parentActionCode for any EXISTING action every boot
 * (though it never touches screenId for an existing row) — since seed-data.ts still declared
 * BILL_RUN_SUBMIT under BILLING_READINESS_BILL_RUN with parentActionCode: 'BILL_RUN_VIEW' at the
 * time, the boot-time correction kept re-linking it to the old parent. seed-data.ts's own
 * BILL_RUN_SUBMIT entry was updated in the SAME change as this migration — moving only the DB row
 * without also fixing the seed source would just be reverted again on the next boot.
 *
 * role_permissions rows are updated for consistency (screenId is a denormalized display-tree
 * convenience column only — roleHasAction() never reads it) — no grant is added or removed, so no
 * role's actual authorization changes.
 */
export class MoveRunBillingToBillingReadiness1790160463635 implements MigrationInterface {
    name = 'MoveRunBillingToBillingReadiness1790160463635'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const [billingReadinessScreen] = await queryRunner.query(
            `SELECT id FROM screens WHERE code = 'BILLING_READINESS'`,
        );
        if (!billingReadinessScreen) return;

        await queryRunner.query(
            `UPDATE actions SET screenId = ?, parentActionId = NULL, name = 'Run Billing' WHERE code = 'BILL_RUN_SUBMIT'`,
            [billingReadinessScreen.id],
        );
        await queryRunner.query(
            `UPDATE role_permissions rp
             JOIN actions a ON a.id = rp.actionId
             SET rp.screenId = ?
             WHERE a.code = 'BILL_RUN_SUBMIT'`,
            [billingReadinessScreen.id],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const [billRunScreen] = await queryRunner.query(
            `SELECT id FROM screens WHERE code = 'BILLING_READINESS_BILL_RUN'`,
        );
        const [viewAction] = await queryRunner.query(
            `SELECT id FROM actions WHERE code = 'BILL_RUN_VIEW'`,
        );
        if (!billRunScreen || !viewAction) return;

        await queryRunner.query(
            `UPDATE actions SET screenId = ?, parentActionId = ?, name = 'Submit Bill Run' WHERE code = 'BILL_RUN_SUBMIT'`,
            [billRunScreen.id, viewAction.id],
        );
        await queryRunner.query(
            `UPDATE role_permissions rp
             JOIN actions a ON a.id = rp.actionId
             SET rp.screenId = ?
             WHERE a.code = 'BILL_RUN_SUBMIT'`,
            [billRunScreen.id],
        );
    }
}
