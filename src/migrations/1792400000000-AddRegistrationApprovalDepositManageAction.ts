import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 1 (additive only) of the RBAC security assessment's remediation plan for
 * REGISTRATION_APPROVAL_APPROVE: that one code currently guards BOTH the real approve route
 * (POST :id/approve) AND four unrelated deposit-handling routes (request-deposit,
 * record-deposit-payment, verify-deposit, return-receipt) — a role granted only
 * REGISTRATION_APPROVAL_APPROVE (expecting "can approve registrations") silently also gets
 * deposit-handling capability its name/description never signaled.
 *
 * This migration:
 * 1. Inserts the new Action row REGISTRATION_APPROVAL_DEPOSIT_MANAGE (same screen as
 *    REGISTRATION_APPROVAL_APPROVE/REJECT: REGISTRATION_APPROVAL, nested under
 *    REGISTRATION_APPROVAL_VIEW as a sibling — matches seed-data.ts's ACTIONS entry).
 * 2. Grants it to CUSTOMER_SERVICE_SUPERVISOR — the ONE real role (confirmed via a live,
 *    read-only query against this environment before writing this migration) that holds
 *    REGISTRATION_APPROVAL_APPROVE but NOT EDIT_REGISTRATION_REQUEST, meaning it is the one role
 *    that would actually lose access to the 4 deposit routes once (in a LATER, separate migration)
 *    REGISTRATION_APPROVAL_APPROVE is removed from those routes. Granting it now, additively, means
 *    that later removal is a pure no-op for this role's real capability.
 *
 * Deliberately NOT done here (by design — see the controller's own updated @Permission lists):
 * REGISTRATION_APPROVAL_APPROVE is NOT removed from the 4 deposit routes in this migration. Both
 * codes work on those routes side by side until a separate, later migration (requires its own
 * approval) removes the broader code once every role needing deposit access is confirmed to hold
 * the new narrower one.
 *
 * Idempotent: every INSERT is guarded by a SELECT-first existence check, safe to re-run on an
 * environment where this has already applied (e.g. a fresh bootstrap that already seeded the action
 * via ACTIONS, or a re-run after a partial failure).
 */
export class AddRegistrationApprovalDepositManageAction1792400000000 implements MigrationInterface {
    name = 'AddRegistrationApprovalDepositManageAction1792400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const [screen] = await queryRunner.query(
            `SELECT id, subModuleId, pModuleId FROM screens WHERE code = 'REGISTRATION_APPROVAL'`,
        );
        if (!screen) return; // Bootstrap hasn't run yet in this environment — nothing to migrate.

        const [parentAction] = await queryRunner.query(
            `SELECT id FROM actions WHERE code = 'REGISTRATION_APPROVAL_VIEW'`,
        );

        const [existingAction] = await queryRunner.query(
            `SELECT id FROM actions WHERE code = 'REGISTRATION_APPROVAL_DEPOSIT_MANAGE'`,
        );

        let actionId: number;
        if (existingAction) {
            actionId = existingAction.id;
        } else {
            await queryRunner.query(
                `INSERT INTO actions (screenId, parentActionId, name, code, description, isActive, displayOrder, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 1, 4, NOW(), NOW())`,
                [
                    screen.id,
                    parentAction?.id ?? null,
                    'Manage Registration Deposit',
                    'REGISTRATION_APPROVAL_DEPOSIT_MANAGE',
                    'Request a security deposit, record a deposit payment, verify a paid deposit, or return a payment receipt for correction — split out from REGISTRATION_APPROVAL_APPROVE so holding the approve code no longer silently also grants deposit-handling capability.',
                ],
            );
            const [inserted] = await queryRunner.query(
                `SELECT id FROM actions WHERE code = 'REGISTRATION_APPROVAL_DEPOSIT_MANAGE'`,
            );
            actionId = inserted.id;
        }

        // Determine moduleId — role_permissions.moduleId is required (not nullable), resolved from
        // the screen's own module chain (subModule -> pModule, or screen -> pModule directly), same
        // precedence CollapseBillingReadinessTabScreens' own grant-preservation logic assumes.
        let moduleId: number | null = screen.pModuleId ?? null;
        let subModuleId: number | null = screen.subModuleId ?? null;
        if (!moduleId && subModuleId) {
            const [subModule] = await queryRunner.query(
                `SELECT pModuleId FROM sub_modules WHERE id = ?`,
                [subModuleId],
            );
            moduleId = subModule?.pModuleId ?? null;
        }
        if (!moduleId) return; // Should not happen for a real, seeded screen — fail safe, grant nothing rather than an invalid row.

        const [role] = await queryRunner.query(
            `SELECT id FROM roles WHERE role_name = 'CUSTOMER_SERVICE_SUPERVISOR'`,
        );
        if (!role) return; // Role doesn't exist in this environment — nothing to grant.

        const [existingGrant] = await queryRunner.query(
            `SELECT id FROM role_permissions WHERE roleId = ? AND actionId = ? AND deleted_at IS NULL`,
            [role.id, actionId],
        );
        if (!existingGrant) {
            await queryRunner.query(
                `INSERT INTO role_permissions (roleId, moduleId, subModuleId, screenId, actionId, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
                [role.id, moduleId, subModuleId, screen.id, actionId],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const [action] = await queryRunner.query(
            `SELECT id FROM actions WHERE code = 'REGISTRATION_APPROVAL_DEPOSIT_MANAGE'`,
        );
        if (!action) return;

        // Removes ONLY the grant/action this migration created — never touches any pre-existing
        // REGISTRATION_APPROVAL_APPROVE/EDIT_REGISTRATION_REQUEST grant, which this migration never
        // modified in the first place.
        await queryRunner.query(
            `DELETE FROM role_permissions WHERE actionId = ?`,
            [action.id],
        );
        await queryRunner.query(
            `DELETE FROM actions WHERE id = ?`,
            [action.id],
        );
    }
}
