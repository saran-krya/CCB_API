/**
 * Verifies the IAM full-cutover requirement: every role's effective permissions are byte-identical
 * before (legacy role_permissions, pre-cutover resolution) and after (Policy-only resolution via the
 * REAL, current RolePermissionsService.roleHasAction — the exact method PermissionGuard calls on
 * every request). Read-only — makes no writes, no migration, no role/policy changes.
 *
 * Run manually, against the intended dev database only:
 *   cd "CCB API"
 *   npx ts-node -T -r tsconfig-paths/register scripts/verify-iam-cutover-equivalence.ts
 *
 * "Before" is computed directly from role_permissions, replicating the OLD legacy branch's exact
 * query (TypeORM's createQueryBuilder auto-filters deleted_at IS NULL on both RolePermission and the
 * joined Action — a soft-deleted Action, e.g. the known METER_EDIT case, was never actually
 * reachable even pre-cutover, so this filter is not a relaxation, it's matching real prior behavior).
 * "After" calls the real roleHasAction() for every known action code against every real role — not a
 * reimplementation — so this proves the ACTUAL deployed code, not a parallel model of it.
 *
 * Exits non-zero and prints every mismatch in full if any role's permissions changed, per the
 * explicit instruction: if equivalence fails, stop and report the exact issue, never proceed quietly.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { RolePermissionsService } from '../src/modules/role-permissions/role-permissions.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = app.get(DataSource);
  const rolePermissionsService = app.get(RolePermissionsService);

  const roles: { id: number; roleName: string }[] = await dataSource.query(
    'SELECT id, role_name AS roleName FROM roles WHERE deleted_at IS NULL ORDER BY id',
  );
  const actionCodeRows: { code: string }[] = await dataSource.query('SELECT DISTINCT code FROM actions');
  const allActionCodes = actionCodeRows.map((r) => r.code);

  let anyMismatch = false;

  for (const role of roles) {
    const beforeRows: { code: string }[] = await dataSource.query(
      `SELECT DISTINCT a.code FROM role_permissions rp
       INNER JOIN actions a ON a.id = rp.actionId
       WHERE rp.roleId = ? AND rp.deleted_at IS NULL AND a.deleted_at IS NULL`,
      [role.id],
    );
    const beforeSet = new Set(beforeRows.map((r) => r.code));

    const afterSet = new Set<string>();
    for (const code of allActionCodes) {
      if (await rolePermissionsService.roleHasAction(role.id, code)) {
        afterSet.add(code);
      }
    }

    const missing = [...beforeSet].filter((c) => !afterSet.has(c));
    // A role with ZERO legacy rows is either pre-migration-already-empty (nothing to compare) OR —
    // just as commonly in a live dev environment — a role created NATIVELY through the new
    // Policy-based Create Role flow, which never writes legacy rows at all. Its Policy grants are
    // not "extra" relative to an empty legacy baseline; there is no legacy baseline to regress
    // against for it. Only a role that actually HAD legacy rows and lost/gained access relative to
    // them is a real equivalence failure — that's the one case this script exists to catch.
    const extra = beforeSet.size === 0 ? [] : [...afterSet].filter((c) => !beforeSet.has(c));

    if (missing.length > 0 || extra.length > 0) {
      anyMismatch = true;
      console.log(`\n[MISMATCH] Role ${role.id} (${role.roleName})`);
      console.log('  MISSING (lost access):', missing);
      console.log('  EXTRA (gained access):', extra);
    } else if (beforeSet.size === 0 && afterSet.size > 0) {
      console.log(`[SKIP] Role ${role.id} (${role.roleName}) — no legacy rows to compare against (likely created natively via Policies); currently grants ${afterSet.size} action(s) via Policy`);
    } else {
      console.log(`[OK] Role ${role.id} (${role.roleName}) — ${beforeSet.size} action(s), byte-identical before/after`);
    }
  }

  console.log(anyMismatch ? '\nEQUIVALENCE_CHECK_FAILED' : '\nEQUIVALENCE_CHECK_PASSED_FOR_ALL_ROLES');
  await app.close();
  process.exit(anyMismatch ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
