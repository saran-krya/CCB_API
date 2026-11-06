/**
 * Removes the rows that earlier soft deletes left behind in the IAM tables — rows that point at a user, role
 * or policy that no longer exists. They grant nothing (every live check ignores them) but they inflate
 * counts, show up in reports and, for user_roles, used to block deleting a role. The code that caused them
 * is fixed (deleting a role/policy/user now removes its own dependents in the same transaction); this script
 * clears what was already there.
 *
 * DRY RUN BY DEFAULT — it only reports counts. Nothing changes without --apply, and --apply runs every
 * delete in ONE transaction, then re-counts and prints the result (all zeros when it worked).
 *
 *   cd "CCB API"
 *   APP_ENV=<env>   (unset = .env; see src/config/env-file.ts)  \
 *   npx ts-node -T -r tsconfig-paths/register scripts/maintenance/cleanup-iam-orphans.ts            # report only
 *   npx ts-node -T -r tsconfig-paths/register scripts/maintenance/cleanup-iam-orphans.ts --apply    # delete
 *
 * Point it at the intended database on purpose: it prints the target (user@host/database) first. Take a
 * backup of a shared database before using --apply. Business data is never touched — only the IAM rows
 * listed below.
 */
import { AppDataSource } from '../../src/config/data-source';

interface Check {
  label: string;
  /** How many rows the fix would affect. */
  count: string;
  /** The fix. A DELETE, or (for sessions) an UPDATE that revokes. */
  fix: string;
}

const CHECKS: Check[] = [
  {
    label: "role inline policies whose role is deleted (their statements go with them via the FK cascade)",
    count: 'SELECT COUNT(*) AS n FROM role_inline_policies ip LEFT JOIN roles r ON r.id = ip.roleId WHERE r.id IS NULL OR r.deleted_at IS NOT NULL',
    fix: 'DELETE ip FROM role_inline_policies ip LEFT JOIN roles r ON r.id = ip.roleId WHERE r.id IS NULL OR r.deleted_at IS NOT NULL',
  },
  {
    label: "user inline policies whose user is deleted (statements cascade)",
    count: 'SELECT COUNT(*) AS n FROM user_inline_policies ip LEFT JOIN users u ON u.id = ip.userId WHERE u.id IS NULL OR u.deleted_at IS NOT NULL',
    fix: 'DELETE ip FROM user_inline_policies ip LEFT JOIN users u ON u.id = ip.userId WHERE u.id IS NULL OR u.deleted_at IS NOT NULL',
  },
  {
    label: "policy statements whose policy is deleted",
    count: 'SELECT COUNT(*) AS n FROM policy_statements s LEFT JOIN policies p ON p.id = s.policyId WHERE p.id IS NULL OR p.deleted_at IS NOT NULL',
    fix: 'DELETE s FROM policy_statements s LEFT JOIN policies p ON p.id = s.policyId WHERE p.id IS NULL OR p.deleted_at IS NOT NULL',
  },
  {
    label: "role assignments (user_roles) of deleted users",
    count: 'SELECT COUNT(*) AS n FROM user_roles ur LEFT JOIN users u ON u.id = ur.user_id WHERE u.id IS NULL OR u.deleted_at IS NOT NULL',
    fix: 'DELETE ur FROM user_roles ur LEFT JOIN users u ON u.id = ur.user_id WHERE u.id IS NULL OR u.deleted_at IS NOT NULL',
  },
  {
    label: "role assignments (user_roles) pointing at deleted roles",
    count: 'SELECT COUNT(*) AS n FROM user_roles ur LEFT JOIN roles r ON r.id = ur.role_id WHERE r.id IS NULL OR r.deleted_at IS NOT NULL',
    fix: 'DELETE ur FROM user_roles ur LEFT JOIN roles r ON r.id = ur.role_id WHERE r.id IS NULL OR r.deleted_at IS NOT NULL',
  },
  {
    label: "policy attachments (role_policies) of deleted roles or deleted policies",
    count: 'SELECT COUNT(*) AS n FROM role_policies rp LEFT JOIN roles r ON r.id = rp.roleId LEFT JOIN policies p ON p.id = rp.policyId WHERE r.id IS NULL OR r.deleted_at IS NOT NULL OR p.id IS NULL OR p.deleted_at IS NOT NULL',
    fix: 'DELETE rp FROM role_policies rp LEFT JOIN roles r ON r.id = rp.roleId LEFT JOIN policies p ON p.id = rp.policyId WHERE r.id IS NULL OR r.deleted_at IS NOT NULL OR p.id IS NULL OR p.deleted_at IS NOT NULL',
  },
  {
    label: "live staff sessions (refresh tokens) of deleted users — REVOKED, not deleted",
    count: "SELECT COUNT(*) AS n FROM refresh_tokens t LEFT JOIN users u ON u.id = t.user_id WHERE t.principal_type = 'staff' AND t.revoked_at IS NULL AND (u.id IS NULL OR u.deleted_at IS NOT NULL)",
    fix: "UPDATE refresh_tokens t LEFT JOIN users u ON u.id = t.user_id SET t.revoked_at = NOW() WHERE t.principal_type = 'staff' AND t.revoked_at IS NULL AND (u.id IS NULL OR u.deleted_at IS NOT NULL)",
  },
];

async function main() {
  const apply = process.argv.includes('--apply');
  await AppDataSource.initialize();
  const runner = AppDataSource.createQueryRunner();
  try {
    const counts = async () => {
      const result: Record<string, number> = {};
      for (const check of CHECKS) result[check.label] = Number((await runner.query(check.count))[0].n);
      return result;
    };

    const before = await counts();
    console.log(apply ? 'APPLY mode — the fixes below will be run in one transaction.' : 'DRY RUN — nothing will be changed (add --apply to fix).');
    for (const check of CHECKS) console.log(`  ${String(before[check.label]).padStart(5)}  ${check.label}`);

    const total = Object.values(before).reduce((sum, n) => sum + n, 0);
    if (!apply || total === 0) {
      console.log(total === 0 ? 'Nothing to clean up.' : `\n${total} row(s) would be affected.`);
      return;
    }

    await runner.startTransaction();
    try {
      for (const check of CHECKS) {
        if (before[check.label] === 0) continue;
        const result = await runner.query(check.fix);
        console.log(`  fixed ${String(result?.affectedRows ?? '?').padStart(5)}  ${check.label}`);
      }
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }

    const after = await counts();
    console.log('\nAfter the cleanup:');
    for (const check of CHECKS) console.log(`  ${String(after[check.label]).padStart(5)}  ${check.label}`);
    if (Object.values(after).some((n) => n > 0)) process.exitCode = 1;
  } finally {
    await runner.release();
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Cleanup failed — nothing was committed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
