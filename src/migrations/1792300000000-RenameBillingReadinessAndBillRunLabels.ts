import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Pure display-name rename, no code/behavior change — part of the RBAC label-clarity pass:
 * - BILLING_READINESS_VIEW: 'View' -> 'View Billing Readiness' (the bare "View" label only made
 *   sense with its screen context visible, which the flat Roles & Permissions tree doesn't show).
 * - BILL_RUN_SUBMIT: 'Run Billing' -> 'Submit Bill Run' (groups visually with its sibling
 *   BILL_RUN_VIEW/BILL_RUN_APPROVE as a verb-on-the-same-noun family in the admin tree).
 * - BILL_RUN_APPROVE: 'Approve Bill Run' -> 'Approve / Reject / Return Bill Run' (this one code
 *   gates all three transitions — PATCH :id/approve, :id/reject, :id/return in bill-run.controller.ts
 *   — so the old label understated what granting it actually allows).
 * Action ids/codes are unchanged, so no existing grant, guard, or frontend usePermission() check is
 * affected — this only changes what an admin reads in the Roles & Permissions UI.
 */
export class RenameBillingReadinessAndBillRunLabels1792300000000 implements MigrationInterface {
    name = 'RenameBillingReadinessAndBillRunLabels1792300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fresh install: `actions` doesn't exist at all yet (migrations run before
        // `synchronize: true` does — see 1788342228029's own comment for the confirmed cold-start
        // evidence), which would fail the UPDATEs below outright. Safe to skip: bootstrap's own
        // seed-data.ts already seeds these actions with their final, renamed display names.
        if (!(await queryRunner.hasTable('actions'))) return;

        await queryRunner.query(`UPDATE actions SET name = 'View Billing Readiness' WHERE code = 'BILLING_READINESS_VIEW'`);
        await queryRunner.query(`UPDATE actions SET name = 'Submit Bill Run' WHERE code = 'BILL_RUN_SUBMIT'`);
        await queryRunner.query(`UPDATE actions SET name = 'Approve / Reject / Return Bill Run' WHERE code = 'BILL_RUN_APPROVE'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE actions SET name = 'View' WHERE code = 'BILLING_READINESS_VIEW'`);
        await queryRunner.query(`UPDATE actions SET name = 'Run Billing' WHERE code = 'BILL_RUN_SUBMIT'`);
        await queryRunner.query(`UPDATE actions SET name = 'Approve Bill Run' WHERE code = 'BILL_RUN_APPROVE'`);
    }
}
