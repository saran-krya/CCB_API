import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Permission-model simplification: 11 Action codes confirmed — via @Permission(...) decorator
 * co-occurrence across every controller in the codebase, plus seed-data.ts's own pre-existing
 * descriptions explicitly calling several of them "an alternate to X, the same underlying action" —
 * to be duplicate codes for a capability an existing, differently-named code already gates. Each is
 * folded onto exactly one surviving code (never two survivors merged into each other).
 *
 * VIEW_USER is the odd one out: it was never referenced by a single @Permission(...) decorator
 * anywhere — fully dead code — while USER_OVERVIEW is the real, live "view the user list" action, so
 * USER_OVERVIEW is kept as the survivor (not VIEW_USER, despite its name being the more "obvious"
 * View label) specifically so no controller needs to change.
 *
 * Genuinely distinct business permissions were confirmed NOT to be part of this map and are left
 * completely untouched: TARIFF_SUBMIT/DEACTIVATE/REACTIVATE/DEPRECATE/NEW_VERSION,
 * BILLING_CYCLE_RESUBMIT/DEPRECATE/EXPORT, REGISTRATION_APPROVAL_DEPOSIT_MANAGE (itself a deliberate
 * split out of the old REGISTRATION_APPROVAL_APPROVE, kept as its own distinct capability), and the
 * parallel METER/METER_INVENTORY resource pair (a structural parent/child split, not a same-resource
 * duplicate — left alone).
 *
 * DISPLAY LABELS: `actions.name` has a DB-level UNIQUE index (confirmed the hard way — an earlier
 * version of this migration tried to rename every survivor to a bare "View"/"Approve"/"Reject" and
 * failed with "Duplicate entry 'View' for key actions.IDX_...", since e.g. USER_OVERVIEW,
 * TARIFF_VIEW, VIEW_BILLING_CYCLE and VIEW_REGISTRATION_REQUESTS would all need that exact same
 * name). So the stored Action.name for every code below is left exactly as it was — still fully
 * descriptive and still unique ("View Tariff Detail", "Approve Billing Cycle", etc.). The simplified
 * bare-verb labels the Policy editor's two-panel workspace actually displays (its own Resource-name
 * section header already makes the resource-specific suffix redundant) live purely on the CCB_WEB
 * side as a presentation-only lookup (components/role/actionDisplayLabels.ts), keyed by these same
 * 13 surviving codes — never written back to the database, so this constraint is never at risk again.
 *
 * This migration:
 *   1. Marks each retired code's Action row `isActive = false` (never deleted — PolicyStatement.
 *      actions stores codes as plain strings with no FK, and ActionsService.ensureAction() never
 *      touches isActive on an existing row, so this is a safe, permanent, non-self-healing change —
 *      see resource-catalog.ts's own doc comment for the full precedent this follows).
 *   2. Rewrites every existing policy_statements.actions JSON array: any retired code present is
 *      replaced by its survivor code, with the result de-duplicated (a statement that already held
 *      BOTH codes collapses to one entry, exactly preserving — never expanding or shrinking — its
 *      real effective action set).
 *
 * Idempotent: every step checks current state before writing, safe to re-run. Self-verifying: for
 * every policy_statements row touched, re-reads it FRESH from the database after writing and asserts
 * its resolved action SET (order-independent) matches the pre-migration one exactly, throwing
 * (rolling back the whole transaction) on any mismatch — "preserve existing effective access" is
 * enforced here, not just asserted in a comment.
 */

// retired code -> surviving code it is folded onto. Exported so tests (and CCB_WEB's own
// actionDisplayLabels.ts, which must cover exactly these survivor codes) can validate consistency
// and exercise the fold/de-duplicate logic directly, without needing a real database.
export const CODE_MERGE_MAP: Record<string, string> = {
  VIEW_USER: 'USER_OVERVIEW',
  TARIFF_APPROVAL_VIEW: 'TARIFF_VIEW',
  TARIFF_APPROVAL_QUEUE: 'TARIFF_VIEW',
  TARIFF_APPROVAL_APPROVE: 'TARIFF_APPROVE',
  TARIFF_APPROVAL_REJECT: 'TARIFF_REJECT',
  BILLING_CYCLE_APPROVAL_VIEW: 'VIEW_BILLING_CYCLE',
  BILLING_CYCLE_APPROVAL_APPROVE: 'BILLING_CYCLE_APPROVE',
  BILLING_CYCLE_APPROVAL_REJECT: 'BILLING_CYCLE_REJECT',
  REGISTRATION_APPROVAL_VIEW: 'VIEW_REGISTRATION_REQUESTS',
  REGISTRATION_APPROVAL_APPROVE: 'APPROVE_REGISTRATION_REQUEST',
  REGISTRATION_APPROVAL_REJECT: 'REJECT_REGISTRATION_REQUEST',
};

export class ConsolidateDuplicateActionCodes1792800000000 implements MigrationInterface {
  name = 'ConsolidateDuplicateActionCodes1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fresh install: `actions` doesn't exist at all yet (migrations run before
    // `synchronize: true` does — see 1788342228029's own comment for the confirmed cold-start
    // evidence), which would fail the SELECTs below outright. Safe to skip: the retired codes in
    // CODE_MERGE_MAP are never seeded by seed-data.ts's ACTIONS array at all (confirmed — they were
    // removed from it by this same consolidation), so there is nothing to retire.
    if (!(await queryRunner.hasTable('actions'))) return;

    // 1. Retire the 11 duplicate codes (idempotent — only writes if currently active).
    for (const retiredCode of Object.keys(CODE_MERGE_MAP)) {
      const [existing] = await queryRunner.query(
        `SELECT id, isActive FROM actions WHERE code = ?`,
        [retiredCode],
      );
      if (existing && existing.isActive) {
        await queryRunner.query(`UPDATE actions SET isActive = false WHERE id = ?`, [existing.id]);
      }
    }

    // 2. Rewrite existing policy_statements.actions, folding retired codes onto their survivor, with
    //    a self-check per row that re-reads the row FRESH from the database after writing (not just
    //    re-checking the in-memory value used to build the UPDATE) and compares its resolved
    //    effective-action SET against the pre-migration one — throwing (aborting the whole
    //    transaction) on any mismatch, so no partial state is ever committed.
    const statements: { id: number; actions: string }[] = await queryRunner.query(
      `SELECT id, actions FROM policy_statements`,
    );

    for (const statement of statements) {
      const beforeCodes: string[] = typeof statement.actions === 'string'
        ? JSON.parse(statement.actions)
        : statement.actions;

      if (beforeCodes.every((c) => !CODE_MERGE_MAP[c])) continue; // no retired code present, skip untouched

      const resolvedBefore = new Set(beforeCodes.map((c) => CODE_MERGE_MAP[c] ?? c));
      const afterCodes = [...resolvedBefore];

      await queryRunner.query(`UPDATE policy_statements SET actions = ? WHERE id = ?`, [
        JSON.stringify(afterCodes),
        statement.id,
      ]);

      const [reread]: { actions: string }[] = await queryRunner.query(
        `SELECT actions FROM policy_statements WHERE id = ?`,
        [statement.id],
      );
      const afterSet = new Set<string>(
        typeof reread.actions === 'string' ? JSON.parse(reread.actions) : reread.actions,
      );
      const missing = [...resolvedBefore].filter((c) => !afterSet.has(c));
      const extra = [...afterSet].filter((c) => !resolvedBefore.has(c));
      if (missing.length > 0 || extra.length > 0) {
        throw new Error(
          `Equivalence check FAILED for policy_statements.id=${statement.id}: expected resolved codes ${JSON.stringify([...resolvedBefore])}, re-read from DB got ${JSON.stringify([...afterSet])} (missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}) — aborting migration, no partial state committed`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverting the JSON rewrite exactly (survivor -> which original retired codes it absorbed) is
    // not generally possible without data loss — a statement that already held a survivor code
    // natively (not via merge) is indistinguishable, after the fact, from one that only holds it
    // because a retired sibling was folded in. Reverting isActive is safe and lossless, so this
    // down() restores the Action catalog's active flags to their pre-migration state; it deliberately
    // does NOT attempt to un-merge policy_statements.actions.
    for (const retiredCode of Object.keys(CODE_MERGE_MAP)) {
      await queryRunner.query(`UPDATE actions SET isActive = true WHERE code = ?`, [retiredCode]);
    }
  }
}
