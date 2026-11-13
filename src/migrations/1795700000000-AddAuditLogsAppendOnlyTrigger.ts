import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Enforces append-only `audit_logs` AT THE DATABASE ITSELF (audit finding H3): two BEFORE triggers reject any
 * UPDATE or DELETE against the table, whichever account or code path attempts it. This is the real security
 * boundary, not a convention — no MySQL account-level GRANT can deny UPDATE/DELETE on just one table once that
 * same account legitimately needs UPDATE/DELETE on every OTHER table in this schema (scripts/db/provision-db-users.sql,
 * which documents this exact tradeoff and now grants `TRIGGER` — needed to create these — to the migration
 * account ONLY, never to the API's runtime account, so a fully compromised runtime credential still cannot drop
 * or alter them to cover its tracks).
 *
 * Nothing in the application ever updates or deletes an audit row today — AuditService (src/audit/audit.service.ts)
 * only ever INSERTs, AuditLogController is read-only (no write route) — these triggers make that true BY
 * CONSTRUCTION rather than only by convention, so a future bug, a compromised runtime credential, or a careless
 * ad-hoc query can never silently rewrite or erase history. They also catch a soft-delete: `AuditLog` still
 * extends the shared `BaseEntity` (created_at/updated_at/deleted_at, src/common/entities/base.entity.ts) for now,
 * so nothing stops a future caller from reaching for `.update()`/`.softDelete()` on the repository by mistake —
 * these triggers reject that UPDATE at the database the same as any other, so the inherited columns stay present
 * but harmless. (Dropping those two unused columns is a separate, purely cosmetic follow-up — not a security gap
 * while this trigger stands — left alone here to keep this migration to the one additive change it needs to make.)
 *
 * `BEFORE` rather than `AFTER`: the row is never touched at all, not touched-then-reported. `SIGNAL SQLSTATE
 * '45000'` is the standard MySQL/MariaDB way to fail the statement from inside a trigger with a plain, readable
 * error — nothing about the row itself is echoed back.
 *
 * The CREATE TRIGGER statements below are sent as ONE statement each over the driver's normal query protocol
 * (no `DELIMITER`: that is a `mysql` CLI parsing convention, not something the wire protocol needs — the
 * semicolons inside `BEGIN … END` are part of this one statement's body, same as any other multi-line DDL in
 * this project's migrations).
 *
 * Idempotent against re-running (`DROP TRIGGER IF EXISTS` before each `CREATE`), like this project's other
 * hand-authored migrations. down() drops the two triggers only — no column, no row, no data loss either way —
 * so reverting never loses history; UPDATE/DELETE on `audit_logs` simply stop being blocked again.
 */
export class AddAuditLogsAppendOnlyTrigger1795700000000 implements MigrationInterface {
    name = 'AddAuditLogsAppendOnlyTrigger1795700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TRIGGER IF EXISTS `audit_logs_no_update`');
        await queryRunner.query('DROP TRIGGER IF EXISTS `audit_logs_no_delete`');

        await queryRunner.query(`
            CREATE TRIGGER \`audit_logs_no_update\` BEFORE UPDATE ON \`audit_logs\`
            FOR EACH ROW
            BEGIN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: UPDATE is not permitted';
            END
        `);

        await queryRunner.query(`
            CREATE TRIGGER \`audit_logs_no_delete\` BEFORE DELETE ON \`audit_logs\`
            FOR EACH ROW
            BEGIN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: DELETE is not permitted';
            END
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TRIGGER IF EXISTS `audit_logs_no_update`');
        await queryRunner.query('DROP TRIGGER IF EXISTS `audit_logs_no_delete`');
    }
}
