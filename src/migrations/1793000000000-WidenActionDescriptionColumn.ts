import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Widens `actions.description` from the bare default VARCHAR(255) to VARCHAR(500), matching
 * Policy/Resource's own description column width (see their entities' own `length: 500`).
 *
 * Found via a genuine fresh-install test against an isolated database: bootstrap's own seed()
 * failed inserting REGISTRATION_APPROVAL_DEPOSIT_MANAGE's description (374 chars) with "Data too
 * long for column 'description'" — `synchronize: true` (dev-only) creates this column straight
 * from the Action entity decorator, which had no explicit `length` until this change, so a
 * genuinely fresh database (where migrations run before `synchronize` does — see
 * 1788342228029-RefactorRegistrationRequestSchema's own comment for the confirmed cold-start
 * evidence) got the MySQL default VARCHAR(255) and failed outright on this one seed row. An
 * already-migrated database's `actions.description` column may already be wider than 255 (from
 * whatever `synchronize` last converged it to, or simply never having hit this exact row before),
 * so this migration is a pure widen, never narrows, and is safe to run unconditionally.
 *
 * Idempotent against re-running: MODIFY COLUMN to the same target width is a no-op in MySQL.
 */
export class WidenActionDescriptionColumn1793000000000 implements MigrationInterface {
    name = 'WidenActionDescriptionColumn1793000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fresh install: `actions` doesn't exist at all yet (migrations run before
        // `synchronize: true` does); synchronize will create it from the now-corrected (length: 500)
        // entity decorator directly, so there is nothing to widen here.
        if (!(await queryRunner.hasTable('actions'))) return;

        await queryRunner.query(`ALTER TABLE \`actions\` MODIFY COLUMN \`description\` VARCHAR(500) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('actions'))) return;

        // Best-effort revert to the original bare default — if any existing row's description is
        // already longer than 255 chars (e.g. REGISTRATION_APPROVAL_DEPOSIT_MANAGE's own 374-char
        // seed value, the reason this migration exists), MySQL truncates it rather than failing the
        // ALTER outright. Acceptable for a down() path: reverting this migration is already an
        // explicit, deliberate rollback of the width fix itself.
        await queryRunner.query(`ALTER TABLE \`actions\` MODIFY COLUMN \`description\` VARCHAR(255) NULL`);
    }
}
