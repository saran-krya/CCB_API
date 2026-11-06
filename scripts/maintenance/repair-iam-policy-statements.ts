/**
 * Repairs Policy statements that list an action code the IAM catalog does not allow for their resource —
 * most notably the deliberate `REPAIR_NEEDED_ORIGINAL_VALUE_LOST` placeholder that migration
 * 1793300000000-RepairNullPolicyStatementActions left in a policy whose real actions an earlier
 * `synchronize: true` incident had wiped (the original values are gone; nothing can restore them).
 *
 * What it does, per statement (managed, role-inline and user-inline):
 *   - removes every action code that is not in src/modules/iam/resource-catalog.ts for that statement's
 *     resource — such a code can never be granted through the API (IamService.validateStatements rejects
 *     it), so it is either corruption or a retired code, and it grants nothing;
 *   - if valid codes remain, the statement keeps them; if none remain, the (now empty) statement is deleted.
 * It never touches a code the catalog allows — including IMPORT_CENTER_VIEW, whose problem was an inactive
 * action flag, repaired by migration 1793800000000 — and never changes which policies are attached to which
 * roles. A policy left with no statements is only REPORTED (name and id) for a person to rename or delete in
 * the Policy editor; its name (for example "RENAME ME (original name lost…)") is left as the visible flag.
 *
 * DRY RUN BY DEFAULT; --apply runs every change in one transaction. Take a backup of a shared database first.
 *
 *   cd "CCB API"
 *   npx ts-node -T -r tsconfig-paths/register scripts/maintenance/repair-iam-policy-statements.ts            # report
 *   npx ts-node -T -r tsconfig-paths/register scripts/maintenance/repair-iam-policy-statements.ts --apply    # repair
 */
import { AppDataSource } from '../../src/config/data-source';
import { RESOURCES } from '../../src/modules/iam/resource-catalog';

const STATEMENT_TABLES = [
  { table: 'policy_statements', parent: 'policies', label: 'managed policy' },
  { table: 'role_inline_policy_statements', parent: 'role_inline_policies', label: 'role inline policy' },
  { table: 'user_inline_policy_statements', parent: 'user_inline_policies', label: 'user inline policy' },
] as const;

const allowedByResource = new Map<string, Set<string>>(RESOURCES.map((resource) => [resource.code, new Set(resource.actionCodes)]));

interface Planned {
  table: string;
  id: number;
  policy: string;
  resource: string;
  invalid: string[];
  keep: string[];
}

const parseActions = (value: unknown): string[] => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

async function main() {
  const apply = process.argv.includes('--apply');
  await AppDataSource.initialize();
  const runner = AppDataSource.createQueryRunner();
  try {
    const planned: Planned[] = [];
    for (const { table, parent, label } of STATEMENT_TABLES) {
      const rows: { id: number; actions: unknown; resourceCode: string | null; policyName: string }[] = await runner.query(
        `SELECT s.id, s.actions, r.code AS resourceCode, p.name AS policyName
           FROM ${table} s
           LEFT JOIN resources r ON r.id = s.resourceId
           LEFT JOIN ${parent} p ON p.id = s.policyId
          WHERE s.deleted_at IS NULL`,
      );
      for (const row of rows) {
        const actions = parseActions(row.actions);
        const allowed = row.resourceCode ? allowedByResource.get(row.resourceCode) : undefined;
        const keep = allowed ? actions.filter((code) => allowed.has(code)) : [];
        const invalid = actions.filter((code) => !keep.includes(code));
        if (invalid.length > 0 || actions.length === 0) {
          planned.push({ table, id: row.id, policy: `${label} "${row.policyName ?? '?'}"`, resource: row.resourceCode ?? '?', invalid, keep });
        }
      }
    }

    console.log(apply ? 'APPLY mode — changes run in one transaction.' : 'DRY RUN — nothing will be changed (add --apply to repair).');
    if (planned.length === 0) {
      console.log('No statement lists a code the catalog disallows. Nothing to repair.');
      return;
    }
    for (const item of planned) {
      const outcome = item.keep.length > 0 ? `keep [${item.keep.join(', ')}]` : 'DELETE the empty statement';
      console.log(`  ${item.table}#${item.id}  ${item.policy}  resource ${item.resource}: remove [${item.invalid.join(', ') || '(no actions)'}] -> ${outcome}`);
    }
    if (!apply) return;

    await runner.startTransaction();
    try {
      for (const item of planned) {
        if (item.keep.length > 0) {
          await runner.query(`UPDATE ${item.table} SET actions = CAST(? AS JSON) WHERE id = ?`, [JSON.stringify(item.keep), item.id]);
        } else {
          await runner.query(`DELETE FROM ${item.table} WHERE id = ?`, [item.id]);
        }
      }
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }

    const empty: { id: number; name: string }[] = await runner.query(
      `SELECT p.id, p.name FROM policies p
        WHERE p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM policy_statements s WHERE s.policyId = p.id AND s.deleted_at IS NULL)`,
    );
    console.log(`\nRepaired ${planned.length} statement(s).`);
    if (empty.length > 0) {
      console.log('Policies that now have NO statements (review in the Policy editor — rename and re-add permissions, or delete):');
      for (const policy of empty) console.log(`  policy #${policy.id}  "${policy.name}"`);
    }
  } finally {
    await runner.release();
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Repair failed — nothing was committed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
