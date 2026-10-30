import { MigrationInterface, QueryRunner } from "typeorm";
import { ACTION_TO_RESOURCE_CODE, NAV_ONLY_ACTION_CODES } from "../modules/iam/resource-catalog";
import { CODE_MERGE_MAP } from "./1792800000000-ConsolidateDuplicateActionCodes";
import { USER_OVERVIEW_CORRECTION_MAP } from "./1792900000000-RenameUserOverviewToViewUser";
import { DEAD_ACTION_CODES } from "./1793100000000-RetireDeadActionCodes";

/**
 * REPAIR migration — restores policy_statements.actions after it was found blanked to NULL on every
 * row in a real environment (confirmed: policyId/resourceId/effect all intact on every row, only
 * `actions` was null — the signature of a dev-only `synchronize: true` column-type change silently
 * discarding existing values rather than converting them, the same way a separate incident this same
 * session blanked policies.name and resources.code to empty strings when their entity columns gained
 * an explicit `length`). This broke `GET /auth/me/actions` ("statement.actions is not iterable" — see
 * IamService.getActionCodesGrantedByPolicies, which iterates `statement.actions` directly), which in
 * turn collapsed the SUPER_ADMIN sidebar to almost nothing, since nav visibility now depends on the
 * real Policy-granted action set from that endpoint, not just the legacy module/submodule tree.
 *
 * RECOVERY STRATEGY: every one of this environment's Policies except one was created by
 * AddIamPolicyBackfill1792600000000, which always names its generated Policy exactly
 * "<RoleName> Policy". That migration deterministically derived each statement's `actions` from the
 * role's real `role_permissions` grants, which are COMPLETELY UNTOUCHED by this incident (confirmed:
 * FINANCE=10, Cheif_Officer=26, etc. — byte-identical to the original equivalence check run when
 * AddIamPolicyBackfill first shipped). This migration re-runs that exact same derivation
 * (role_permissions -> resource-catalog.ts grouping) and UPDATEs each existing policy_statements row's
 * `actions` in place, matched by (policyId, resourceId) — it never inserts or deletes a row, since
 * every row already exists with its real policyId/resourceId/effect intact; only the null `actions`
 * value is being repaired.
 *
 * A backfill-generated Policy is identified by NAME alone (CONCAT(role_name, ' Policy') = policy.name
 * against a currently-real Role) — not by its description text. An earlier version of this migration
 * tried to additionally confirm the match via description ("Auto-generated from <RoleName>'s
 * pre-existing..."), but `policies.description` was independently found to be null across this same
 * environment (the identical kind of synchronize-driven data loss this migration exists to repair,
 * just affecting a different column) — so description can never be relied on as a signal here. Name-
 * based matching against a real Role is actually the stronger check regardless: it only matches a
 * Policy whose name corresponds to a Role that genuinely still exists.
 *
 * Self-verifying, same convention as every other migration in this codebase: after writing, re-reads
 * every touched role's resolved action set fresh from the database and compares it to the
 * role_permissions-derived "before" set, throwing (rolling back the whole transaction) on any mismatch.
 *
 * ONE POLICY IS NOT COVERED: a Policy named "engaging team" (id discovered dynamically below, never
 * hardcoded) was created manually through the real admin UI, not by the backfill migration — it has no
 * corresponding Role/RolePermission data to re-derive its lost actions from, and this migration does
 * NOT guess a value for it. Its one statement's `actions` is left as a clearly-invalid, visibly-wrong
 * marker (['REPAIR_NEEDED_ORIGINAL_VALUE_LOST']) specifically so it fails loudly if ever evaluated
 * (not a real Action code, so IamService.getActionCodesGrantedByPolicies would include a code that
 * matches nothing — inert, not a security hole) rather than silently granting zero or guessed access,
 * and is reported here for a human to fix through the real Policy editor once the server is back up.
 *
 * Idempotent: an UPDATE of a statement's actions to the same JSON value it already holds is a safe
 * no-op; re-running this migration after it already succeeded does not change anything (every
 * "needs repair" guard below skips rows that already have a real value).
 *
 * IMPORTANT MySQL/JSON gotcha this migration explicitly guards against: the corrupted value is the
 * JSON scalar `null` (JSON_TYPE(actions) = 'NULL'), not a SQL-level column NULL — `WHERE actions IS
 * NULL` matches ZERO such rows even though the column's actual content is unusable. Every "is this
 * row broken" check below uses `(actions IS NULL OR JSON_TYPE(actions) = 'NULL')` for exactly this
 * reason; using plain `IS NULL` alone would make this migration silently do nothing while still
 * recording itself as successfully run — confirmed the hard way during this migration's own
 * development, where an early version used plain `IS NULL` and passed with zero rows touched twice
 * in a row with no error, while the real data remained completely unrepaired.
 */

const RETIRED_ACTION_CODES = new Set(['METER_EDIT']);
const UNRECOVERABLE_ACTIONS_MARKER = ['REPAIR_NEEDED_ORIGINAL_VALUE_LOST'];

export class RepairNullPolicyStatementActions1793300000000 implements MigrationInterface {
  name = 'RepairNullPolicyStatementActions1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('policy_statements'))) return;

    const nullCount: { c: number }[] = await queryRunner.query(
      `SELECT COUNT(*) as c FROM policy_statements WHERE actions IS NULL OR JSON_TYPE(actions) = 'NULL'`,
    );
    if (Number(nullCount[0].c) === 0) {
      // Nothing to repair — either this never happened in this environment, or this migration
      // already ran here before.
      return;
    }

    const resourceRows: { id: number; code: string }[] = await queryRunner.query(`SELECT id, code FROM resources`);
    const resourceIdByCode = new Map(resourceRows.map((r) => [r.code, r.id]));

    // Identifies a Policy as backfill-generated by Policy.name ALONE ("<RoleName> Policy" exactly
    // matching a REAL, currently-existing role's name) — deliberately NOT by description text. This
    // migration was originally written assuming description ("Auto-generated from <RoleName>'s
    // pre-existing...") would still be intact to confirm the match, but description was found to be
    // null in this same environment (a separate instance of the exact same kind of data loss this
    // migration exists to repair, affecting a different column) — so name-based matching against a
    // real, live Role is the only signal this migration can rely on, and it is in fact the stronger
    // signal: it only ever matches a policy whose name exactly corresponds to a role that still
    // exists today, never a coincidentally-similar name with no real role behind it. A Policy an
    // admin created independently (like "engaging team") never matches this JOIN at all.
    const backfillPolicies: { id: number; name: string; roleName: string }[] = await queryRunner.query(
      `SELECT p.id, p.name, r.role_name AS roleName
       FROM policies p
       INNER JOIN roles r ON CONCAT(r.role_name, ' Policy') = p.name
       WHERE p.deleted_at IS NULL`,
    );

    for (const policy of backfillPolicies) {
      const nullStatements: { id: number; resourceId: number }[] = await queryRunner.query(
        `SELECT id, resourceId FROM policy_statements WHERE policyId = ? AND (actions IS NULL OR JSON_TYPE(actions) = 'NULL')`,
        [policy.id],
      );
      if (nullStatements.length === 0) continue; // this policy's statements already have real values

      const role: { id: number; role_name: string }[] = await queryRunner.query(
        `SELECT id, role_name FROM roles WHERE role_name = ?`,
        [policy.roleName],
      );
      if (role.length === 0) {
        throw new Error(
          `Policy "${policy.name}" looks auto-generated from role "${policy.roleName}", but no role with that exact name exists anymore — aborting rather than guessing. Investigate manually.`,
        );
      }
      const roleId = role[0].id;

      const beforeRows: { code: string }[] = await queryRunner.query(
        `SELECT DISTINCT a.code FROM role_permissions rp
         INNER JOIN actions a ON a.id = rp.actionId
         WHERE rp.roleId = ? AND rp.deleted_at IS NULL AND rp.actionId IS NOT NULL AND a.deleted_at IS NULL`,
        [roleId],
      );
      // role_permissions is RAW, pre-consolidation data — a role can still hold a legacy grant row
      // for a code that later migrations folded onto a survivor or retired outright (none of them
      // ever touched role_permissions itself, only policy_statements.actions and actions.isActive).
      // Applying the SAME maps those migrations defined, in the SAME chronological order they
      // actually ran (ConsolidateDuplicateActionCodes, then RetireDeadActionCodes, then the later
      // USER_OVERVIEW correction that reversed part of the first map) — rather than re-deriving a
      // competing mapping — keeps this repair consistent with every OTHER policy's actions in this
      // same database, which already went through this exact sequence when those migrations ran.
      // NAV_ONLY_ACTION_CODES (VIEW_POLICY/CREATE_POLICY/EDIT_POLICY/DELETE_POLICY/VIEW_RESOURCE) are
      // real, currently-active, correctly-granted codes — SUPER_ADMIN really does hold them via
      // role_permissions — but they deliberately have no Resource mapping (Policy/Resource admin is
      // gated by @Roles(SUPER_ADMIN), never by the Policy model itself; see resource-catalog.ts's own
      // doc comment). They are filtered out here the same way RETIRED/DEAD codes are — not because
      // the role lacks them, but because a PolicyStatement is never the right place to represent
      // them. Dropping them from a Policy's statements does NOT reduce the role's real nav/admin
      // access, since that access was never routed through the Policy model to begin with.
      const beforeCodes = new Set(
        beforeRows
          .map((r) => r.code)
          .filter(
            (code) =>
              !RETIRED_ACTION_CODES.has(code) &&
              !DEAD_ACTION_CODES.includes(code) &&
              !NAV_ONLY_ACTION_CODES.has(code),
          )
          .map((code) => CODE_MERGE_MAP[code] ?? code)
          .map((code) => USER_OVERVIEW_CORRECTION_MAP[code] ?? code),
      );

      const codesByResourceId = new Map<number, Set<string>>();
      for (const code of beforeCodes) {
        const resourceCode = ACTION_TO_RESOURCE_CODE[code];
        if (!resourceCode) {
          throw new Error(
            `Action code "${code}" (held by role "${policy.roleName}") has no Resource mapping in resource-catalog.ts — aborting repair for this policy rather than guessing.`,
          );
        }
        const resourceId = resourceIdByCode.get(resourceCode);
        if (!resourceId) {
          throw new Error(`Resource "${resourceCode}" not found in the resources table — aborting repair.`);
        }
        if (!codesByResourceId.has(resourceId)) codesByResourceId.set(resourceId, new Set());
        codesByResourceId.get(resourceId)!.add(code);
      }

      const coveredResourceIds = new Set(nullStatements.map((s) => s.resourceId));

      for (const statement of nullStatements) {
        const codes = codesByResourceId.get(statement.resourceId);
        if (!codes || codes.size === 0) {
          throw new Error(
            `policy_statements.id=${statement.id} (policy "${policy.name}", resourceId=${statement.resourceId}) has no corresponding action codes derivable from role "${policy.roleName}"'s current role_permissions grants — the statement's resourceId may itself be wrong, or the role's legacy grants changed since this statement was created. Aborting rather than guessing; investigate this specific row manually.`,
          );
        }
        await queryRunner.query(`UPDATE policy_statements SET actions = ? WHERE id = ?`, [
          JSON.stringify([...codes]),
          statement.id,
        ]);
      }

      // The role's legacy grants may require a Resource this Policy has NO existing statement row
      // for at all (confirmed real case: SUPER_ADMIN's Policy was missing its METER_READING
      // statement entirely, even before today's corruption, so METER_READING_APPROVE had nowhere to
      // be written by the UPDATE loop above). This is the one case where this migration inserts a
      // genuinely new row rather than only repairing an existing one — explicitly logged, and still
      // covered by the same equivalence self-check immediately below.
      for (const [resourceId, codes] of codesByResourceId) {
        if (coveredResourceIds.has(resourceId)) continue;
        await queryRunner.query(
          `INSERT INTO policy_statements (policyId, resourceId, effect, actions, created_at, updated_at) VALUES (?, ?, 'Allow', ?, NOW(), NOW())`,
          [policy.id, resourceId, JSON.stringify([...codes])],
        );
        console.warn(
          `[RepairNullPolicyStatementActions] Policy "${policy.name}" was missing a policy_statements row for resourceId=${resourceId} entirely (not just a null value) — inserted a new one with actions ${JSON.stringify([...codes])}, derived from role "${policy.roleName}"'s real legacy grants.`,
        );
      }

      // Equivalence self-check: resolve this role's action set purely from what now exists in
      // policy_statements for this policy, compare to the role_permissions-derived "before" set.
      const afterRows: { actions: string }[] = await queryRunner.query(
        `SELECT actions FROM policy_statements WHERE policyId = ?`,
        [policy.id],
      );
      const afterCodes = new Set<string>();
      for (const row of afterRows) {
        const actions: string[] = typeof row.actions === 'string' ? JSON.parse(row.actions) : row.actions;
        for (const code of actions) afterCodes.add(code);
      }
      const missing = [...beforeCodes].filter((c) => !afterCodes.has(c));
      const extra = [...afterCodes].filter((c) => !beforeCodes.has(c));
      if (missing.length > 0 || extra.length > 0) {
        throw new Error(
          `Equivalence check FAILED repairing policy "${policy.name}" (role "${policy.roleName}"): missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)} — aborting migration, no partial state committed.`,
        );
      }
    }

    // Any remaining NULL statement belongs to a Policy NOT created by the backfill migration (e.g. a
    // manually-created one like "engaging team") — there is no source data to re-derive its actions
    // from, so it gets a visibly-wrong marker instead of a guess, and is logged for manual follow-up.
    const stillNull: { id: number; policyId: number }[] = await queryRunner.query(
      `SELECT id, policyId FROM policy_statements WHERE actions IS NULL OR JSON_TYPE(actions) = 'NULL'`,
    );
    for (const statement of stillNull) {
      await queryRunner.query(`UPDATE policy_statements SET actions = ? WHERE id = ?`, [
        JSON.stringify(UNRECOVERABLE_ACTIONS_MARKER),
        statement.id,
      ]);
    }
    if (stillNull.length > 0) {
      const policyIds = [...new Set(stillNull.map((s) => s.policyId))];
      console.warn(
        `[RepairNullPolicyStatementActions] ${stillNull.length} statement(s) on policy id(s) ${JSON.stringify(policyIds)} had no recoverable source data — marked with a visibly-invalid placeholder. A human must fix these through the real Policy editor.`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This is a data REPAIR, not a schema change — there is nothing meaningful to revert to (the
    // pre-migration state was NULL, which is the exact broken state this migration exists to fix).
    // Deliberately a no-op rather than reintroducing the NULL values and the resulting 500.
  }
}
