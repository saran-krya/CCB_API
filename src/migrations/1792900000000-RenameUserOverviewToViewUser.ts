import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Correction to the permission-model consolidation: USER_OVERVIEW — despite being the live, real
 * "view the user list/detail" action (VIEW_USER, its sibling, was confirmed dead code and retired
 * onto it by 1792800000000-ConsolidateDuplicateActionCodes.ts) — is itself a tab/screen-named code
 * ("Overview" names a specific panel, not the Users resource's general View capability), which is
 * exactly the kind of tab-specific permission naming this whole effort exists to remove. The
 * Resource's common View permission must be named after the capability, not the screen that used to
 * expose it.
 *
 * This migration SWAPS which of the two existing rows is active, rather than renaming either row's
 * `code` in place — `actions.code` has the same DB-level unique index as `actions.name` (confirmed
 * alongside it), so simply UPDATE-ing USER_OVERVIEW's code to 'VIEW_USER' would collide with the
 * already-existing (inactive) VIEW_USER row. Swapping avoids that collision entirely: no row's code
 * or name is ever modified, only `isActive` flips and policy_statements.actions is rewritten.
 *
 *   - VIEW_USER: isActive false -> true (its name, "View Users", is reused unchanged — exactly the
 *     name sibling resources' own View action already uses, e.g. "View Roles", "View Communities").
 *   - USER_OVERVIEW: isActive true -> false (now retired, same as every other code this effort has
 *     folded away — never deleted, just stops being selectable or creatable).
 *   - Every policy_statements row holding USER_OVERVIEW has it replaced with VIEW_USER, de-duplicated
 *     against whatever that statement already held (preserving — never expanding or shrinking —
 *     effective access), verified via the same re-read-from-DB self-check pattern as the prior
 *     migration, throwing and rolling back on any mismatch.
 *
 * user.controller.ts's three `@Permission('USER_OVERVIEW')` decorators are updated to
 * `@Permission('VIEW_USER')` in the same commit as this migration — the migration alone does not
 * change what passes PermissionGuard; that happens in source, deployed together.
 */
// retired code -> surviving code, same shape/convention as CODE_MERGE_MAP in the prior migration —
// exported so tests can exercise the fold logic and validate catalog consistency without a database.
export const USER_OVERVIEW_CORRECTION_MAP: Record<string, string> = {
  USER_OVERVIEW: 'VIEW_USER',
};

export class RenameUserOverviewToViewUser1792900000000 implements MigrationInterface {
  name = 'RenameUserOverviewToViewUser1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fresh install: `actions` doesn't exist at all yet (migrations run before `synchronize: true`
    // does — see 1788342228029's own comment for the confirmed cold-start evidence), which would
    // fail the SELECTs below outright. Safe to skip: bootstrap's own seed-data.ts already seeds
    // VIEW_USER active and never seeds the retired USER_OVERVIEW at all.
    if (!(await queryRunner.hasTable('actions'))) return;

    const [viewUser] = await queryRunner.query(`SELECT id, isActive FROM actions WHERE code = 'VIEW_USER'`);
    const [userOverview] = await queryRunner.query(`SELECT id, isActive FROM actions WHERE code = 'USER_OVERVIEW'`);

    if (viewUser && !viewUser.isActive) {
      await queryRunner.query(`UPDATE actions SET isActive = true WHERE id = ?`, [viewUser.id]);
    }
    if (userOverview && userOverview.isActive) {
      await queryRunner.query(`UPDATE actions SET isActive = false WHERE id = ?`, [userOverview.id]);
    }

    const statements: { id: number; actions: string }[] = await queryRunner.query(
      `SELECT id, actions FROM policy_statements`,
    );

    for (const statement of statements) {
      const beforeCodes: string[] = typeof statement.actions === 'string'
        ? JSON.parse(statement.actions)
        : statement.actions;

      if (beforeCodes.every((c) => !USER_OVERVIEW_CORRECTION_MAP[c])) continue;

      const resolvedBefore = new Set(beforeCodes.map((c) => USER_OVERVIEW_CORRECTION_MAP[c] ?? c));
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
    const [viewUser] = await queryRunner.query(`SELECT id FROM actions WHERE code = 'VIEW_USER'`);
    const [userOverview] = await queryRunner.query(`SELECT id FROM actions WHERE code = 'USER_OVERVIEW'`);
    if (viewUser) await queryRunner.query(`UPDATE actions SET isActive = false WHERE id = ?`, [viewUser.id]);
    if (userOverview) await queryRunner.query(`UPDATE actions SET isActive = true WHERE id = ?`, [userOverview.id]);
    // Does not attempt to un-swap policy_statements.actions — same rationale as the prior
    // migration's down(): once de-duplicated, which original code a statement "really" held is not
    // always recoverable, so reverting the Action catalog's active flags is the safe, lossless part.
  }
}
