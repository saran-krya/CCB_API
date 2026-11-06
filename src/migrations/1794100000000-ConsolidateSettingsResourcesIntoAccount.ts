import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Personal Settings and Security pages were first seeded as EIGHT Resources, one per page (SETTINGS_PROFILE, SETTINGS_APPEARANCE,
 * SETTINGS_REGIONAL, SETTINGS_DISPLAY, SETTINGS_NOTIFICATIONS, SETTINGS_PASSWORD, SETTINGS_SESSIONS, SETTINGS_LOGIN_HISTORY). They are
 * now ONE Resource, ACCOUNT, whose actions are grouped by page in the Policy editor — the AWS-style "one resource, many actions" shape.
 * The ACTION CODES are unchanged (a statement stores codes, not a foreign key to an action), so only the statement's RESOURCE moves.
 *
 * What this does, per statement table (policy_statements, role_inline_policy_statements, user_inline_policy_statements):
 *   - every LIVE statement on one of the eight old resources is folded into ONE statement on ACCOUNT for the same policy — the union
 *     of the codes it held, merged into the policy's existing ACCOUNT statement if it already has one. A policy that held Profile and
 *     Regional ends up with one ACCOUNT statement listing exactly those four codes, so nothing is granted or revoked by the move;
 *   - the old statements are then deleted (the statement -> resource foreign key is RESTRICT), and so are the eight resource rows.
 * Also renames the Active Sessions UPDATE action to "Revoke Active Sessions" (its code is unchanged), because the Policy editor now
 * presents it as "Active Sessions: Revoke".
 *
 * Idempotent: with none of the eight resources present (a fresh database, an already-migrated one) it changes nothing. Self-verifying:
 * after each fold it re-reads the ACCOUNT statement and asserts it holds every code that was folded in, and it refuses to delete an old
 * resource that is still referenced — either throws and rolls the whole migration back. ACCOUNT is created here only when missing; the
 * normal boot step (IamService.ensureResourceCatalog) keeps its name, order and description in step with resource-catalog.ts.
 *
 * down() splits each ACCOUNT statement back into per-page statements by code, restores the eight resources and removes ACCOUNT.
 */
const ACCOUNT = {
  code: 'ACCOUNT',
  name: 'Account',
  description:
    'Your own account in Settings: profile, appearance, regional and display preferences, notifications, password, sessions and login history',
  displayOrder: 22,
};

/** The eight per-page resources, with the action codes each one held. */
const PAGE_RESOURCES = [
  { code: 'SETTINGS_PROFILE', name: 'Profile Settings', displayOrder: 22, actions: ['SETTINGS_PROFILE_VIEW', 'SETTINGS_PROFILE_UPDATE'] },
  { code: 'SETTINGS_APPEARANCE', name: 'Appearance Settings', displayOrder: 23, actions: ['SETTINGS_APPEARANCE_VIEW', 'SETTINGS_APPEARANCE_UPDATE'] },
  { code: 'SETTINGS_REGIONAL', name: 'Regional Preferences', displayOrder: 24, actions: ['SETTINGS_REGIONAL_VIEW', 'SETTINGS_REGIONAL_UPDATE'] },
  { code: 'SETTINGS_DISPLAY', name: 'Display Preferences', displayOrder: 25, actions: ['SETTINGS_DISPLAY_VIEW', 'SETTINGS_DISPLAY_UPDATE'] },
  { code: 'SETTINGS_NOTIFICATIONS', name: 'Notification Preferences', displayOrder: 26, actions: ['SETTINGS_NOTIFICATIONS_VIEW', 'SETTINGS_NOTIFICATIONS_UPDATE'] },
  { code: 'SETTINGS_PASSWORD', name: 'Change Password', displayOrder: 27, actions: ['SETTINGS_PASSWORD_VIEW', 'SETTINGS_PASSWORD_UPDATE'] },
  { code: 'SETTINGS_SESSIONS', name: 'Active Sessions', displayOrder: 28, actions: ['SETTINGS_SESSIONS_VIEW', 'SETTINGS_SESSIONS_UPDATE'] },
  { code: 'SETTINGS_LOGIN_HISTORY', name: 'Login History', displayOrder: 29, actions: ['SETTINGS_LOGIN_HISTORY_VIEW'] },
] as const;

/** ACCOUNT's codes in the catalogue's order, so a merged statement reads the way the editor lists them. */
const ACCOUNT_CODES: string[] = PAGE_RESOURCES.flatMap((page) => [...page.actions]);

const STATEMENT_TABLES = ['policy_statements', 'role_inline_policy_statements', 'user_inline_policy_statements'] as const;

const SESSIONS_UPDATE_CODE = 'SETTINGS_SESSIONS_UPDATE';
const SESSIONS_UPDATE_NAME_OLD = 'Manage Active Sessions';
const SESSIONS_UPDATE_NAME_NEW = 'Revoke Active Sessions';

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

const parseActions = (value: unknown): string[] => {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') return JSON.parse(value) as string[];
  return [];
};

/** Unique codes, in ACCOUNT_CODES order first (any code the catalogue does not know keeps its place after them). */
const orderedUnion = (...lists: string[][]): string[] => {
  const all = new Set(lists.flat());
  const known = ACCOUNT_CODES.filter((code) => all.has(code));
  const rest = [...all].filter((code) => !ACCOUNT_CODES.includes(code));
  return [...known, ...rest];
};

export class ConsolidateSettingsResourcesIntoAccount1794100000000 implements MigrationInterface {
  name = 'ConsolidateSettingsResourcesIntoAccount1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fresh install: the schema does not exist yet (or is empty) — nothing to convert, and the boot-time seed creates ACCOUNT itself.
    if (!(await queryRunner.hasTable('resources'))) return;

    await this.renameSessionsAction(queryRunner, SESSIONS_UPDATE_NAME_OLD, SESSIONS_UPDATE_NAME_NEW);

    const oldCodes = PAGE_RESOURCES.map((page) => page.code);
    const oldResources: { id: number; code: string }[] = await queryRunner.query(
      `SELECT id, code FROM resources WHERE code IN (${placeholders(oldCodes.length)})`,
      oldCodes,
    );
    if (oldResources.length === 0) return;
    const oldIds = oldResources.map((resource) => resource.id);

    let [account]: { id: number }[] = await queryRunner.query(`SELECT id FROM resources WHERE code = ?`, [ACCOUNT.code]);
    if (!account) {
      await queryRunner.query(`INSERT INTO resources (code, name, description, displayOrder) VALUES (?, ?, ?, ?)`, [
        ACCOUNT.code,
        ACCOUNT.name,
        ACCOUNT.description,
        ACCOUNT.displayOrder,
      ]);
      [account] = await queryRunner.query(`SELECT id FROM resources WHERE code = ?`, [ACCOUNT.code]);
    }

    for (const table of STATEMENT_TABLES) {
      if (!(await queryRunner.hasTable(table))) continue;

      // Only LIVE statements are carried over: a soft-deleted one must not come back to life as a grant. Every old row is deleted below.
      const live: { id: number; policyId: number; actions: unknown }[] = await queryRunner.query(
        `SELECT id, policyId, actions FROM \`${table}\` WHERE resourceId IN (${placeholders(oldIds.length)}) AND deleted_at IS NULL ORDER BY id`,
        oldIds,
      );
      const codesByPolicy = new Map<number, string[]>();
      for (const row of live) {
        codesByPolicy.set(row.policyId, [...(codesByPolicy.get(row.policyId) ?? []), ...parseActions(row.actions)]);
      }

      for (const [policyId, folded] of codesByPolicy) {
        const [existing]: { id: number; actions: unknown }[] = await queryRunner.query(
          `SELECT id, actions FROM \`${table}\` WHERE policyId = ? AND resourceId = ? AND deleted_at IS NULL ORDER BY id LIMIT 1`,
          [policyId, account.id],
        );
        const merged = orderedUnion(existing ? parseActions(existing.actions) : [], folded);

        if (existing) {
          await queryRunner.query(`UPDATE \`${table}\` SET actions = ? WHERE id = ?`, [JSON.stringify(merged), existing.id]);
        } else {
          await queryRunner.query(`INSERT INTO \`${table}\` (policyId, resourceId, effect, actions) VALUES (?, ?, 'Allow', ?)`, [
            policyId,
            account.id,
            JSON.stringify(merged),
          ]);
        }

        const [reread]: { actions: unknown }[] = await queryRunner.query(
          `SELECT actions FROM \`${table}\` WHERE policyId = ? AND resourceId = ? AND deleted_at IS NULL ORDER BY id LIMIT 1`,
          [policyId, account.id],
        );
        const now = new Set(parseActions(reread?.actions));
        const missing = folded.filter((code) => !now.has(code));
        if (missing.length > 0) {
          throw new Error(
            `Equivalence check FAILED for ${table} policyId=${policyId}: the ACCOUNT statement is missing ${JSON.stringify(missing)} after the fold — aborting migration, no partial state committed`,
          );
        }
      }

      await queryRunner.query(`DELETE FROM \`${table}\` WHERE resourceId IN (${placeholders(oldIds.length)})`, oldIds);
    }

    // The foreign key is RESTRICT, so a leftover reference would already have failed the delete — say it plainly instead.
    for (const table of STATEMENT_TABLES) {
      if (!(await queryRunner.hasTable(table))) continue;
      const [{ remaining }]: { remaining: number | string }[] = await queryRunner.query(
        `SELECT COUNT(*) AS remaining FROM \`${table}\` WHERE resourceId IN (${placeholders(oldIds.length)})`,
        oldIds,
      );
      if (Number(remaining) > 0) {
        throw new Error(`${table} still references a per-page Settings resource after the fold — aborting migration, no partial state committed`);
      }
    }
    await queryRunner.query(`DELETE FROM resources WHERE id IN (${placeholders(oldIds.length)})`, oldIds);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('resources'))) return;

    await this.renameSessionsAction(queryRunner, SESSIONS_UPDATE_NAME_NEW, SESSIONS_UPDATE_NAME_OLD);

    const [account]: { id: number }[] = await queryRunner.query(`SELECT id FROM resources WHERE code = ?`, [ACCOUNT.code]);
    if (!account) return;

    // Restore the eight per-page resources (their descriptions are re-synced by IamService.ensureResourceCatalog on the next boot).
    const pageIds = new Map<string, number>();
    for (const page of PAGE_RESOURCES) {
      let [row]: { id: number }[] = await queryRunner.query(`SELECT id FROM resources WHERE code = ?`, [page.code]);
      if (!row) {
        await queryRunner.query(`INSERT INTO resources (code, name, displayOrder) VALUES (?, ?, ?)`, [page.code, page.name, page.displayOrder]);
        [row] = await queryRunner.query(`SELECT id FROM resources WHERE code = ?`, [page.code]);
      }
      pageIds.set(page.code, row.id);
    }

    for (const table of STATEMENT_TABLES) {
      if (!(await queryRunner.hasTable(table))) continue;
      const statements: { id: number; policyId: number; actions: unknown }[] = await queryRunner.query(
        `SELECT id, policyId, actions FROM \`${table}\` WHERE resourceId = ? AND deleted_at IS NULL`,
        [account.id],
      );
      for (const statement of statements) {
        const held = new Set(parseActions(statement.actions));
        for (const page of PAGE_RESOURCES) {
          const codes = page.actions.filter((code) => held.has(code));
          if (codes.length === 0) continue;
          await queryRunner.query(`INSERT INTO \`${table}\` (policyId, resourceId, effect, actions) VALUES (?, ?, 'Allow', ?)`, [
            statement.policyId,
            pageIds.get(page.code),
            JSON.stringify(codes),
          ]);
        }
      }
      await queryRunner.query(`DELETE FROM \`${table}\` WHERE resourceId = ?`, [account.id]);
    }
    await queryRunner.query(`DELETE FROM resources WHERE id = ?`, [account.id]);
  }

  /** Renames the Active Sessions UPDATE action (its code stays) — only when it still carries `from` and `to` is free (action names are unique). */
  private async renameSessionsAction(queryRunner: QueryRunner, from: string, to: string): Promise<void> {
    if (!(await queryRunner.hasTable('actions'))) return;
    const [taken] = await queryRunner.query(`SELECT id FROM actions WHERE name = ? LIMIT 1`, [to]);
    if (taken) return;
    await queryRunner.query(`UPDATE actions SET name = ? WHERE code = ? AND name = ?`, [to, SESSIONS_UPDATE_CODE, from]);
  }
}
