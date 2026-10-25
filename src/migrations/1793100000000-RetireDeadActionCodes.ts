import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * RBAC cleanup audit: three Action codes confirmed — via a full grep of every controller, service and
 * frontend caller — to gate NO real capability on either side, unlike the already-documented
 * "reserved for a planned feature" codes (METER_INVENTORY_DELETE, VIEW_SERVICE_REQUESTS_TICKETS):
 *
 *   CREATE_ATTRIBUTE / DELETE_ATTRIBUTE — attribute.controller.ts only ever exposed GET/GET :id/PATCH;
 *     no create or delete route or service method ever existed on either side.
 *   EXPORT_BILLING_CYCLE — billing-cycle.controller.ts never had an export route or service method;
 *     no frontend caller ever existed either (this migration corrects resource-catalog.ts's own
 *     earlier comment, which had assumed it was a distinct, intentionally-kept capability).
 *
 * Unlike 1792800000000-ConsolidateDuplicateActionCodes.ts, there is no surviving code to fold these
 * onto — they are simply removed from every policy_statements row that happens to hold them (all
 * three were only ever present via the SUPER_ADMIN auto-grant's "every active action" rule, never
 * deliberately attached to a custom policy — confirmed against the live `ccb` database before writing
 * this migration), and marked `isActive = false` on the `actions` row itself so a fresh Resource/
 * Policy-editor listing (IamService.findAllResourcesWithActions filters by isActive) never offers them
 * again. The row itself is never deleted — same reasoning as the precedent migration: PolicyStatement.
 * actions stores codes as plain strings with no FK, and ActionsService.ensureAction() never touches
 * isActive on an existing row, so this is a safe, permanent, non-self-healing change.
 *
 * Idempotent: every step checks current state before writing, safe to re-run. Self-verifying: for
 * every policy_statements row touched, re-reads it FRESH from the database after writing and asserts
 * the dead codes are gone and every OTHER code in that statement is unchanged, throwing (rolling back
 * the whole transaction) on any mismatch.
 */
export const DEAD_ACTION_CODES = ['CREATE_ATTRIBUTE', 'DELETE_ATTRIBUTE', 'EXPORT_BILLING_CYCLE'];

export class RetireDeadActionCodes1793100000000 implements MigrationInterface {
  name = 'RetireDeadActionCodes1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fresh install: `actions` doesn't exist yet (migrations run before `synchronize: true` does —
    // see 1788342228029's own comment for the confirmed cold-start evidence). Safe to skip: these
    // three codes are no longer in seed-data.ts's ACTIONS array, so a fresh install never creates
    // them at all.
    if (!(await queryRunner.hasTable('actions'))) return;

    // 1. Retire the 3 dead codes (idempotent — only writes if currently active).
    for (const deadCode of DEAD_ACTION_CODES) {
      const [existing] = await queryRunner.query(`SELECT id, isActive FROM actions WHERE code = ?`, [deadCode]);
      if (existing && existing.isActive) {
        await queryRunner.query(`UPDATE actions SET isActive = false WHERE id = ?`, [existing.id]);
      }
    }

    // 2. Strip any of the 3 dead codes out of existing policy_statements.actions JSON arrays — there
    //    is no survivor to fold onto, so this is a pure removal, with a self-check that every OTHER
    //    code in the row is preserved exactly.
    const statements: { id: number; actions: string }[] = await queryRunner.query(
      `SELECT id, actions FROM policy_statements`,
    );

    for (const statement of statements) {
      const beforeCodes: string[] = typeof statement.actions === 'string'
        ? JSON.parse(statement.actions)
        : statement.actions;

      if (beforeCodes.every((c) => !DEAD_ACTION_CODES.includes(c))) continue; // nothing to strip, skip untouched

      const expectedAfter = new Set(beforeCodes.filter((c) => !DEAD_ACTION_CODES.includes(c)));

      await queryRunner.query(`UPDATE policy_statements SET actions = ? WHERE id = ?`, [
        JSON.stringify([...expectedAfter]),
        statement.id,
      ]);

      const [reread]: { actions: string }[] = await queryRunner.query(
        `SELECT actions FROM policy_statements WHERE id = ?`,
        [statement.id],
      );
      const afterSet = new Set<string>(
        typeof reread.actions === 'string' ? JSON.parse(reread.actions) : reread.actions,
      );
      const missing = [...expectedAfter].filter((c) => !afterSet.has(c));
      const extra = [...afterSet].filter((c) => !expectedAfter.has(c));
      if (missing.length > 0 || extra.length > 0) {
        throw new Error(
          `Equivalence check FAILED for policy_statements.id=${statement.id}: expected ${JSON.stringify([...expectedAfter])}, re-read from DB got ${JSON.stringify([...afterSet])} (missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}) — aborting migration, no partial state committed`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverting the JSON strip exactly (which statements originally held a dead code) is not
    // possible without data loss once other writes have happened since. Reverting isActive is safe
    // and lossless, so this down() restores the Action catalog's active flags only; it deliberately
    // does NOT attempt to re-insert the stripped codes into policy_statements.
    for (const deadCode of DEAD_ACTION_CODES) {
      await queryRunner.query(`UPDATE actions SET isActive = true WHERE code = ?`, [deadCode]);
    }
  }
}
