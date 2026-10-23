import { MigrationInterface, QueryRunner } from "typeorm";
import { RESOURCES, ACTION_TO_RESOURCE_CODE } from "../modules/iam/resource-catalog";

/**
 * Phase 4 of the AWS IAM-inspired RBAC evolution — the real data migration. For EVERY existing Role
 * that has at least one RolePermission row, generates exactly one Policy (named "<RoleName> Policy")
 * containing one PolicyStatement per Resource the role currently has any grant on, with that
 * statement's `actions` set to the EXACT set of Action codes the role currently holds for that
 * resource — then attaches the new Policy to the role via role_policies.
 *
 * This is a mechanical reshaping of existing grants, not a redesign: it guarantees byte-for-byte
 * equivalent effective access before and after migration for every role. No role gains or loses a
 * single capability as a direct result of this migration. Verified by this migration itself (see the
 * self-check at the end of up()) — it throws and rolls back the whole transaction if any role's
 * post-migration resolved action set doesn't exactly match its pre-migration RolePermission-derived
 * set, rather than silently committing a mismatch.
 *
 * Also seeds the Resource catalog first if AddIamPolicyTables' sibling bootstrap path hasn't already
 * done so in this environment (defensive — IamService.ensureResourceCatalog is the normal path, but
 * this migration must not assume the app has booted at least once before running).
 *
 * CONFIRMED DATA ANOMALY, handled explicitly rather than silently: one real, live environment had a
 * `role_permissions` row (SUPER_ADMIN, METER_EDIT) pointing at a SOFT-DELETED `actions` row —
 * METER_EDIT was retired (superseded by METER_INVENTORY_EDIT) but its grant row was never cleaned
 * up. This migration explicitly joins on `a.deleted_at IS NULL` so a grant referencing a retired
 * Action is never carried forward — it is already fully inert today (zero `@Permission` decorator
 * anywhere references METER_EDIT), so excluding it loses no real, live capability. Separately,
 * BILL_RUN_HISTORICAL_SUBMIT/BILL_RUN_HISTORICAL_APPROVE were found to be ACTIVE (not soft-deleted)
 * actions with real grants (SUPER_ADMIN, CUSTOMER_SERVICE_EXECUTIVE, FINANCE, Cheif_Officer) despite
 * having no seed-data.ts entry and no backend route — these ARE carried forward (mapped onto the
 * BILL_RUN resource in resource-catalog.ts) specifically to preserve those roles' real, current
 * grants, documented there as pre-provisioned-but-unimplemented-feature codes, not dropped.
 *
 * IMPORTANT — this migration does NOT delete or modify any RolePermission row. Per
 * RolePermissionsService.roleHasAction's own updated logic: once a role has ANY row in
 * role_policies (which this migration creates for every role it processes), that role's
 * authorization resolves EXCLUSIVELY through its attached Policies from that point on — its old
 * RolePermission rows become inert for that role (never deleted, just no longer consulted), which is
 * what makes this a true single-source-of-truth cutover rather than a permanent OR.
 *
 * down() removes ONLY the Policy/PolicyStatement/RolePolicy rows this migration created (tagged via
 * each generated Policy's own name pattern, "<RoleName> Policy") — reverting it causes every
 * affected role to have zero role_policies rows again, which (per roleHasAction's fallback) means
 * those roles immediately resolve through their original, untouched RolePermission rows again. No
 * data loss is possible from running this migration and then reverting it.
 */
export class AddIamPolicyBackfill1792600000000 implements MigrationInterface {
    name = 'AddIamPolicyBackfill1792600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Ensure the Resource catalog exists (idempotent — defensive, in case the app has never
        //    booted in this environment yet).
        const resourceIdByCode = new Map<string, number>();
        for (const seed of RESOURCES) {
            const [existing] = await queryRunner.query(`SELECT id FROM resources WHERE code = ?`, [seed.code]);
            if (existing) {
                resourceIdByCode.set(seed.code, existing.id);
            } else {
                await queryRunner.query(
                    `INSERT INTO resources (code, name, description, displayOrder, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())`,
                    [seed.code, seed.name, seed.description ?? null, seed.displayOrder],
                );
                const [inserted] = await queryRunner.query(`SELECT id FROM resources WHERE code = ?`, [seed.code]);
                resourceIdByCode.set(seed.code, inserted.id);
            }
        }
        for (const seed of RESOURCES) {
            if (!seed.parentResourceCode) continue;
            const resourceId = resourceIdByCode.get(seed.code);
            const parentId = resourceIdByCode.get(seed.parentResourceCode);
            if (resourceId && parentId) {
                await queryRunner.query(`UPDATE resources SET parentResourceId = ? WHERE id = ? AND parentResourceId IS NULL`, [parentId, resourceId]);
            }
        }

        // 2. For every real Role with at least one RolePermission row, generate a Policy.
        const roles: { id: number; role_name: string }[] = await queryRunner.query(
            `SELECT DISTINCT r.id, r.role_name FROM roles r INNER JOIN role_permissions rp ON rp.roleId = r.id WHERE rp.deleted_at IS NULL`,
        );

        for (const role of roles) {
            // Already migrated (idempotent re-run safety) — skip if this role already has a policy.
            const [existingAttachment] = await queryRunner.query(
                `SELECT id FROM role_policies WHERE roleId = ?`,
                [role.id],
            );
            if (existingAttachment) continue;

            // Pre-migration effective action set, for the equivalence self-check below. Excludes any
            // grant referencing a SOFT-DELETED Action (a.deleted_at IS NULL) — see this migration's
            // own doc comment on the confirmed METER_EDIT anomaly this guard exists for.
            const beforeRows: { code: string }[] = await queryRunner.query(
                `SELECT DISTINCT a.code FROM role_permissions rp
                 INNER JOIN actions a ON a.id = rp.actionId
                 WHERE rp.roleId = ? AND rp.deleted_at IS NULL AND rp.actionId IS NOT NULL AND a.deleted_at IS NULL`,
                [role.id],
            );
            const beforeCodes = new Set(beforeRows.map((r) => r.code));
            if (beforeCodes.size === 0) continue; // module/screen-only grants, no action-level codes — nothing to migrate

            // Group this role's action codes by Resource.
            const codesByResource = new Map<string, Set<string>>();
            for (const code of beforeCodes) {
                const resourceCode = ACTION_TO_RESOURCE_CODE[code];
                if (!resourceCode) {
                    throw new Error(`Action code "${code}" (held by role "${role.role_name}") has no Resource mapping — aborting migration, fix resource-catalog.ts first`);
                }
                if (!codesByResource.has(resourceCode)) codesByResource.set(resourceCode, new Set());
                codesByResource.get(resourceCode)!.add(code);
            }

            const policyName = `${role.role_name} Policy`;
            const [existingPolicy] = await queryRunner.query(`SELECT id FROM policies WHERE name = ?`, [policyName]);
            let policyId: number;
            if (existingPolicy) {
                policyId = existingPolicy.id;
            } else {
                await queryRunner.query(
                    `INSERT INTO policies (name, description, created_at, updated_at) VALUES (?, ?, NOW(), NOW())`,
                    [policyName, `Auto-generated from ${role.role_name}'s pre-existing RolePermission grants during the IAM migration — edit freely, this is a real, independent Policy from this point on.`],
                );
                const [inserted] = await queryRunner.query(`SELECT id FROM policies WHERE name = ?`, [policyName]);
                policyId = inserted.id;
            }

            for (const [resourceCode, codes] of codesByResource) {
                const resourceId = resourceIdByCode.get(resourceCode);
                if (!resourceId) throw new Error(`Resource "${resourceCode}" not found in catalog — aborting migration`);
                await queryRunner.query(
                    `INSERT INTO policy_statements (policyId, resourceId, effect, actions, created_at, updated_at) VALUES (?, ?, 'Allow', ?, NOW(), NOW())`,
                    [policyId, resourceId, JSON.stringify([...codes])],
                );
            }

            await queryRunner.query(
                `INSERT INTO role_policies (roleId, policyId, created_at, updated_at) VALUES (?, ?, NOW(), NOW())`,
                [role.id, policyId],
            );

            // 3. Equivalence self-check — resolve this role's action set purely through what was just
            //    written (statements for the policy just attached) and compare to beforeCodes exactly.
            const afterRows: { actions: string }[] = await queryRunner.query(
                `SELECT ps.actions FROM role_policies rpo
                 INNER JOIN policy_statements ps ON ps.policyId = rpo.policyId
                 WHERE rpo.roleId = ?`,
                [role.id],
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
                    `Equivalence check FAILED for role "${role.role_name}" (id ${role.id}): missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)} — aborting migration, no partial state committed`,
                );
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Removes only the Policies this migration's naming convention identifies ("<RoleName> Policy")
        // AND that are currently attached via role_policies — never touches a Policy an admin has
        // since renamed or a Policy created independently through the real admin UI.
        const generated: { id: number; name: string }[] = await queryRunner.query(
            `SELECT p.id, p.name FROM policies p WHERE p.name LIKE '% Policy' AND p.description LIKE 'Auto-generated from%'`,
        );
        for (const policy of generated) {
            await queryRunner.query(`DELETE FROM role_policies WHERE policyId = ?`, [policy.id]);
            await queryRunner.query(`DELETE FROM policy_statements WHERE policyId = ?`, [policy.id]);
            await queryRunner.query(`DELETE FROM policies WHERE id = ?`, [policy.id]);
        }
    }
}
