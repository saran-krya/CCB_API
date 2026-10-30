import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Backs real backend protection for the boot-generated SUPER_ADMIN Policy — until this migration,
 * "system-managed" existed ONLY as a frontend display label (CCB_Web's SUPER_ADMIN_POLICY_NAME
 * string match in policyTableColumns.tsx), with ZERO backend enforcement: any SUPER_ADMIN session
 * could PATCH or DELETE that policy via the ordinary API, same as any other policy, since
 * PolicyController is @Roles(SUPER_ADMIN)-gated as a whole but has no per-policy check at all
 * (confirmed by reading iam.service.ts's updatePolicy/removePolicy in full — neither checks name,
 * id, or any flag).
 *
 * `is_system` is a plain boolean, default false — every existing policy (including the current
 * "SUPER_ADMIN Policy" row, wherever it exists in a given environment) is unaffected until a
 * separate, explicit backfill sets it true for that one row (see the UP step below, matched by name
 * at migration time ONLY as a one-time backfill of existing data — this is NOT how the application
 * decides "is this system-managed" going forward; that decision is made exclusively by
 * IamService.ensureAdminPolicyGrants, the one boot-time code path allowed to set this column, never
 * by the Create/Update Policy API).
 *
 * Idempotent against re-running (checks column existence first), matching this project's other
 * hand-authored migrations (see 1793200000000-AddMustChangePasswordToUsers.ts).
 */
export class AddIsSystemToPolicies1793500000000 implements MigrationInterface {
    name = 'AddIsSystemToPolicies1793500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fresh install: `policies` doesn't exist yet (migrations run before `synchronize: true`
        // does). Safe to skip: synchronize creates `policies` immediately after migrations finish,
        // with this column already on it from the current Policy entity definition, and the very
        // next boot's ensureAdminPolicyGrants call sets is_system=true on the SUPER_ADMIN Policy it
        // creates for a fresh install, same as it always creates that policy from scratch today.
        if (!(await queryRunner.hasTable('policies'))) return;

        const hasColumn = await queryRunner.hasColumn('policies', 'is_system');
        if (!hasColumn) {
            await queryRunner.query(`ALTER TABLE \`policies\` ADD \`is_system\` tinyint NOT NULL DEFAULT 0`);
        }

        // One-time backfill for an existing environment: the policy literally named "SUPER_ADMIN
        // Policy" today IS the one ensureAdminPolicyGrants has been creating/reconciling on every
        // boot since AddIamPolicyBackfill — mark it system-managed now so protection takes effect
        // immediately, without waiting for a future boot cycle to notice. A name match here is a
        // one-time, one-row data correction for pre-existing rows, not an ongoing mechanism — the
        // running application never again decides "is_system" by matching a name after this.
        await queryRunner.query(
            `UPDATE \`policies\` SET \`is_system\` = 1 WHERE \`name\` = 'SUPER_ADMIN Policy' AND \`is_system\` = 0`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.hasColumn('policies', 'is_system');
        if (hasColumn) {
            await queryRunner.query(`ALTER TABLE \`policies\` DROP COLUMN \`is_system\``);
        }
    }
}
