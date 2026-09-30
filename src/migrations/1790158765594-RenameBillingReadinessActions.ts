import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Pure display-name rename, no code/behavior change: "View Dashboard" → "View",
 * "View Property Billing Readiness" → "View Property Details" — the old names still read like
 * per-screen/tab labels even after CollapseBillingReadinessTabScreens flattened both actions onto
 * one real screen, which is what actually caused the Roles UI to still look like it displayed
 * separate screen-level permissions. Action ids/codes (BILLING_READINESS_VIEW,
 * BILLING_READINESS_PROPERTY_VIEW) are unchanged, so no existing grant, guard, or frontend
 * usePermission() check is affected — this only changes what an admin reads in the Roles UI.
 */
export class RenameBillingReadinessActions1790158765594 implements MigrationInterface {
    name = 'RenameBillingReadinessActions1790158765594'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE actions SET name = 'View' WHERE code = 'BILLING_READINESS_VIEW'`);
        await queryRunner.query(`UPDATE actions SET name = 'View Property Details' WHERE code = 'BILLING_READINESS_PROPERTY_VIEW'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE actions SET name = 'View Dashboard' WHERE code = 'BILLING_READINESS_VIEW'`);
        await queryRunner.query(`UPDATE actions SET name = 'View Property Billing Readiness' WHERE code = 'BILLING_READINESS_PROPERTY_VIEW'`);
    }
}
