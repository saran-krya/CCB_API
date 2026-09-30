import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Removes the standalone "Verify Company KYC" staff action (VERIFY_COMPANY_KYC and its Registration
 * Approval alternate, REGISTRATION_APPROVAL_VERIFY_COMPANY_KYC) — explicit decision NOT to model
 * Company.tradeLicenseVerified/.trnVerified as an independent staff decision behind a separate
 * action. These two flags are now DERIVED directly from RegistrationDocument.extractedFields[]
 * .verified evidence at approve() time (see RegistrationRequestService.deriveAndAssertCompanyKyc),
 * folded into the SAME Required Document Verification workflow every other document type already
 * uses — never a parallel "Company KYC" concept. The POST :id/verify-company-kyc endpoint, its
 * service method, and its DTO were removed from the codebase in the same change.
 *
 * Neither action has any child action parented under it, so there is no parentActionId to
 * re-home (unlike RemoveEditBillingCycle's BILLING_CYCLE_NEW_VERSION/DEPRECATE re-parenting).
 *
 * Soft-deletes both actions (matches the established EDIT_BILLING_CYCLE / BILLING_ISSUE /
 * BILLING_READINESS_PROPERTY_VIEW removal pattern) rather than a hard delete — roleHasAction()'s
 * real generated SQL joins actions with "deleted_at IS NULL", so this alone removes both from
 * authorization and the RBAC admin tree while preserving the historical rows. Their role_permissions
 * rows (SUPER_ADMIN, via admin auto-grant) are deleted outright for hygiene.
 */
export class RemoveCompanyKycVerificationAction1790750942000 implements MigrationInterface {
    name = 'RemoveCompanyKycVerificationAction1790750942000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const actions = await queryRunner.query(
            `SELECT id FROM actions WHERE code IN ('VERIFY_COMPANY_KYC', 'REGISTRATION_APPROVAL_VERIFY_COMPANY_KYC') AND deleted_at IS NULL`,
        );
        if (!actions.length) return;

        const ids = actions.map((a: { id: number }) => a.id);
        await queryRunner.query(
            `DELETE FROM role_permissions WHERE actionId IN (${ids.map(() => '?').join(',')})`,
            ids,
        );
        await queryRunner.query(
            `UPDATE actions SET deleted_at = NOW() WHERE id IN (${ids.map(() => '?').join(',')})`,
            ids,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Not reversed — the standalone Company KYC verification action was intentionally
        // discontinued, not a mistake to roll back. A rollback would resurrect a permission code the
        // app no longer grants any endpoint for (its controller/service methods are gone), leaving a
        // dangling grant, exactly as RemoveEditBillingCycle's own down() reasons through.
    }
}
