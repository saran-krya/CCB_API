/**
 * READ-ONLY audit of the IAM and workflow data against the rules the API enforces on every write. It reports and
 * never changes anything (every query runs inside START TRANSACTION READ ONLY), so it is safe against any database.
 *
 *   1. Policy statements — managed, role-inline and user-inline — that the API would refuse today: an unknown
 *      resource, an action code that is unknown / inactive / not in that resource's catalogue, an effect other
 *      than Allow, no actions at all, or the same resource twice in one policy.
 *   2. Business-approval codes stored for SUPER_ADMIN or for a user who holds it. At runtime they are ignored
 *      (SUPER_ADMIN never holds them); the SUPER_ADMIN system policy is also cleaned on every API start. Anything
 *      listed here other than that system policy has to be edited or detached by an administrator.
 *   3. Active workflow levels whose approver role is SUPER_ADMIN, or no longer holds the workflow's approve code
 *      through its policies — a level nobody can act on.
 *
 * Exit code 0 = clean, 2 = something was found (usable as a deploy gate), 1 = the audit itself failed.
 * Repairs stay with scripts/maintenance/repair-iam-policy-statements.ts (dry run by default).
 *
 *   cd "CCB API"
 *   APP_ENV=<env>   (unset = .env; see src/config/env-file.ts)  \
 *   npx ts-node -T -r tsconfig-paths/register scripts/maintenance/audit-iam-rbac.ts
 */
import { AppDataSource } from '../../src/config/data-source';
import { APPROVE_ACTION_CODES, BUSINESS_APPROVAL_ACTION_CODES } from '../../src/modules/iam/business-approval-actions';
import { RESOURCES } from '../../src/modules/iam/resource-catalog';

const SUPER_ADMIN = 'SUPER_ADMIN';

const STATEMENT_TABLES = [
  { table: 'policy_statements', parent: 'policies', label: 'managed policy' },
  { table: 'role_inline_policy_statements', parent: 'role_inline_policies', label: 'role inline policy' },
  { table: 'user_inline_policy_statements', parent: 'user_inline_policies', label: 'user inline policy' },
] as const;

const allowedByResource = new Map<string, Set<string>>(RESOURCES.map((resource) => [resource.code, new Set(resource.actionCodes)]));

const parseActions = (value: unknown): string[] => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

async function main() {
  await AppDataSource.initialize();
  const runner = AppDataSource.createQueryRunner();
  const findings: string[] = [];
  const report = (section: string, lines: string[]) => {
    console.log(`\n${section}: ${lines.length === 0 ? 'clean' : `${lines.length} finding(s)`}`);
    for (const line of lines) console.log(`  - ${line}`);
    findings.push(...lines);
  };

  try {
    await runner.query('SET SESSION TRANSACTION READ ONLY');
    await runner.query('START TRANSACTION READ ONLY');

    const activeCodes = new Set<string>(
      (await runner.query('SELECT code FROM actions WHERE isActive = 1 AND deleted_at IS NULL')).map((row: { code: string }) => row.code),
    );

    // 1 ── statements the API would refuse today
    const statementProblems: string[] = [];
    for (const { table, parent, label } of STATEMENT_TABLES) {
      const rows: { id: number; policyId: number; effect: string; actions: unknown; resourceCode: string | null; policyName: string }[] =
        await runner.query(
          `SELECT s.id, s.policyId, s.effect, s.actions, r.code AS resourceCode, p.name AS policyName
             FROM ${table} s
             JOIN ${parent} p ON p.id = s.policyId AND p.deleted_at IS NULL
             LEFT JOIN resources r ON r.id = s.resourceId
            WHERE s.deleted_at IS NULL`,
        );
      const perPolicyResource = new Map<string, number>();
      for (const row of rows) {
        const where = `${table}#${row.id} (${label} "${row.policyName}", resource ${row.resourceCode ?? '?'})`;
        const actions = parseActions(row.actions);
        const allowed = row.resourceCode ? allowedByResource.get(row.resourceCode) : undefined;
        if (!row.resourceCode || !allowed) statementProblems.push(`${where}: unknown resource`);
        if (row.effect !== 'Allow') statementProblems.push(`${where}: effect is "${row.effect}", only Allow is supported`);
        if (actions.length === 0) statementProblems.push(`${where}: lists no actions`);
        for (const code of actions) {
          if (!activeCodes.has(code)) statementProblems.push(`${where}: unknown or inactive action code "${code}"`);
          else if (allowed && !allowed.has(code)) statementProblems.push(`${where}: "${code}" does not belong to that resource`);
        }
        const key = `${table}:${row.policyId}:${row.resourceCode}`;
        perPolicyResource.set(key, (perPolicyResource.get(key) ?? 0) + 1);
      }
      for (const [key, count] of perPolicyResource) {
        if (count > 1) statementProblems.push(`${key.split(':')[0]} policy #${key.split(':')[1]}: resource ${key.split(':')[2]} appears in ${count} statements`);
      }
    }
    report('1. policy statements the API would refuse today', statementProblems);

    // 2 ── business-approval codes stored for SUPER_ADMIN or one of its holders
    const approvalProblems: string[] = [];
    const restrictedIn = (value: unknown) => parseActions(value).filter((code) => BUSINESS_APPROVAL_ACTION_CODES.has(code));
    const attachedRows: { roleName: string; policyName: string; isSystem: number; actions: unknown }[] = await runner.query(
      `SELECT r.role_name AS roleName, p.name AS policyName, p.is_system AS isSystem, s.actions
         FROM role_policies rp
         JOIN roles r ON r.id = rp.roleId AND r.deleted_at IS NULL
         JOIN policies p ON p.id = rp.policyId AND p.deleted_at IS NULL
         JOIN policy_statements s ON s.policyId = p.id AND s.deleted_at IS NULL
        WHERE rp.deleted_at IS NULL`,
    );
    for (const row of attachedRows.filter((r) => r.roleName === SUPER_ADMIN)) {
      const codes = restrictedIn(row.actions);
      if (codes.length > 0) {
        const where = row.isSystem ? 'the system policy (cleaned automatically on the next API start)' : `policy "${row.policyName}" (edit or detach it)`;
        approvalProblems.push(`SUPER_ADMIN holds ${codes.join(', ')} through ${where}`);
      }
    }
    const roleInlineRows: { roleName: string; policyName: string; actions: unknown }[] = await runner.query(
      `SELECT r.role_name AS roleName, ip.name AS policyName, s.actions
         FROM role_inline_policy_statements s
         JOIN role_inline_policies ip ON ip.id = s.policyId AND ip.deleted_at IS NULL
         JOIN roles r ON r.id = ip.roleId AND r.deleted_at IS NULL
        WHERE s.deleted_at IS NULL`,
    );
    for (const row of roleInlineRows.filter((r) => r.roleName === SUPER_ADMIN)) {
      const codes = restrictedIn(row.actions);
      if (codes.length > 0) approvalProblems.push(`SUPER_ADMIN holds ${codes.join(', ')} through its inline policy "${row.policyName}" (edit or delete it)`);
    }
    const userInlineRows: { userId: number; policyName: string; actions: unknown; roleName: string }[] = await runner.query(
      `SELECT ip.userId AS userId, ip.name AS policyName, s.actions, r.role_name AS roleName
         FROM user_inline_policy_statements s
         JOIN user_inline_policies ip ON ip.id = s.policyId AND ip.deleted_at IS NULL
         JOIN user_roles ur ON ur.user_id = ip.userId
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
        WHERE s.deleted_at IS NULL`,
    );
    for (const row of userInlineRows.filter((r) => r.roleName === SUPER_ADMIN)) {
      const codes = restrictedIn(row.actions);
      if (codes.length > 0) approvalProblems.push(`user #${row.userId} (holds SUPER_ADMIN) has ${codes.join(', ')} in the inline policy "${row.policyName}" (edit or delete it)`);
    }
    report('2. business-approval codes stored for SUPER_ADMIN or a SUPER_ADMIN holder', approvalProblems);

    // 3 ── active workflow levels nobody can act on
    const codesByRole = new Map<number, Set<string>>();
    const addCodes = (roleId: number, actions: unknown) => {
      const set = codesByRole.get(roleId) ?? new Set<string>();
      for (const code of parseActions(actions)) set.add(code);
      codesByRole.set(roleId, set);
    };
    const attachedByRole: { roleId: number; actions: unknown }[] = await runner.query(
      `SELECT rp.roleId AS roleId, s.actions
         FROM role_policies rp
         JOIN policies p ON p.id = rp.policyId AND p.deleted_at IS NULL
         JOIN policy_statements s ON s.policyId = p.id AND s.deleted_at IS NULL AND s.effect = 'Allow'
        WHERE rp.deleted_at IS NULL`,
    );
    for (const row of attachedByRole) addCodes(row.roleId, row.actions);
    const inlineByRole: { roleId: number; actions: unknown }[] = await runner.query(
      `SELECT ip.roleId AS roleId, s.actions
         FROM role_inline_policy_statements s
         JOIN role_inline_policies ip ON ip.id = s.policyId AND ip.deleted_at IS NULL
        WHERE s.deleted_at IS NULL AND s.effect = 'Allow'`,
    );
    for (const row of inlineByRole) addCodes(row.roleId, row.actions);

    const levels: { workflowType: string; levelOrder: number; roleId: number; roleName: string }[] = await runner.query(
      `SELECT d.workflowType AS workflowType, l.levelOrder AS levelOrder, l.roleId AS roleId, r.role_name AS roleName
         FROM workflow_definition_levels l
         JOIN workflow_definitions d ON d.id = l.definitionId AND d.status = 'ACTIVE' AND d.deleted_at IS NULL
         JOIN roles r ON r.id = l.roleId AND r.deleted_at IS NULL
        WHERE l.deleted_at IS NULL
        ORDER BY d.workflowType, l.levelOrder`,
    );
    const workflowProblems: string[] = [];
    for (const level of levels) {
      const at = `${level.workflowType} workflow, Level ${level.levelOrder + 1}, role "${level.roleName}"`;
      const required = (APPROVE_ACTION_CODES as Record<string, string[]>)[level.workflowType] ?? [];
      if (level.roleName === SUPER_ADMIN) workflowProblems.push(`${at}: SUPER_ADMIN cannot be a workflow approver — publish a new version with a business role`);
      else if (!required.some((code) => codesByRole.get(level.roleId)?.has(code))) {
        workflowProblems.push(`${at}: the role no longer holds ${required.join(' / ')} — grant it again or publish a new version with another role`);
      }
    }
    report('3. active workflow levels nobody can act on', workflowProblems);

    await runner.query('ROLLBACK');
    console.log(findings.length === 0 ? '\nAudit clean.' : `\n${findings.length} finding(s) in total — see above. Nothing was changed.`);
    process.exitCode = findings.length === 0 ? 0 : 2;
  } finally {
    await runner.release();
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Audit failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
