/**
 * One-off backfill: old advisory-only `workflow_approval_levels` rows -> new versioned, enforced
 * `workflow_definitions`/`workflow_definition_levels` (version 1, ACTIVE), per requirement: migrate
 * without losing existing approval configuration, and without inventing missing levels.
 *
 * Run once per environment, manually, before the new engine goes live for a given workflowType:
 *   cd "CCB API"
 *   npx ts-node -T -r tsconfig-paths/register scripts/backfill-workflow-definitions.ts
 *
 * Safe to re-run: a workflowType that ALREADY has a `workflow_definitions` row (from a prior run of
 * this script, or from someone having published a definition through the UI already) is skipped
 * entirely — this script only ever creates version 1, never touches a workflowType that already has
 * real versioned definition history, so it can never silently overwrite someone's real work.
 *
 * Reuses the REAL WorkflowDefinitionService.publishNewVersion() rather than hand-inserting rows —
 * this gets the exact same save-time validation a human publishing through the UI would get (role
 * exists, enum fields valid, SLA positive, no duplicate levels, AND the save-time role-capability
 * check: does this level's role actually hold the real domain approve permission right now). A
 * workflowType whose old advisory level references a role that no longer holds the real permission
 * is correctly REFUSED and reported here, rather than silently carried forward broken — per
 * instruction: preserve existing config where it can be mapped SAFELY, don't lose it, but also don't
 * paper over a mapping that is no longer valid.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { WorkflowDefinitionService } from '../src/modules/workflow/workflow-definition.service';
import { WorkflowDefinition, WorkflowDefinitionStatus } from '../src/modules/workflow/entities/workflow-definition.entity';
import { WorkflowType } from '../src/modules/workflow/dto/workflow.dto';

interface OldApprovalLevelRow {
  workflowType: string;
  levelOrder: number;
  roleId: number;
  department: string | null;
  slaValue: number;
  slaUnit: string;
  onBreach: string;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ds = app.get(DataSource);
  const definitionService = app.get(WorkflowDefinitionService);

  const oldRows: OldApprovalLevelRow[] = await ds.query(
    `SELECT workflowType, levelOrder, roleId, department, slaValue, slaUnit, onBreach
     FROM workflow_approval_levels
     ORDER BY workflowType, levelOrder`,
  );

  if (oldRows.length === 0) {
    console.log('No existing workflow_approval_levels rows found — nothing to backfill.');
    await app.close();
    return;
  }

  const byWorkflowType = new Map<string, OldApprovalLevelRow[]>();
  for (const row of oldRows) {
    const list = byWorkflowType.get(row.workflowType) ?? [];
    list.push(row);
    byWorkflowType.set(row.workflowType, list);
  }

  console.log(`Found ${oldRows.length} old advisory level(s) across ${byWorkflowType.size} workflow type(s): ${[...byWorkflowType.keys()].join(', ')}`);

  const definitionRepo = ds.getRepository(WorkflowDefinition);
  const results: { workflowType: string; outcome: string }[] = [];

  for (const [workflowType, levels] of byWorkflowType) {
    if (!Object.values(WorkflowType).includes(workflowType as WorkflowType)) {
      results.push({ workflowType, outcome: `SKIPPED — "${workflowType}" is not a workflowType this engine recognizes (old data references a type that no longer exists); left untouched.` });
      continue;
    }

    const existing = await definitionRepo.findOne({ where: { workflowType: workflowType as WorkflowType } });
    if (existing) {
      results.push({ workflowType, outcome: `SKIPPED — a workflow_definitions row already exists (version ${existing.version}, status ${existing.status}); this script never overwrites real versioned history.` });
      continue;
    }

    levels.sort((a, b) => a.levelOrder - b.levelOrder);

    try {
      await definitionService.publishNewVersion(
        workflowType as WorkflowType,
        {
          levels: levels.map((l) => ({
            roleId: l.roleId,
            department: l.department,
            slaValue: l.slaValue,
            slaUnit: l.slaUnit,
            onBreach: l.onBreach,
          })),
        } as any,
        undefined,
      );
      results.push({ workflowType, outcome: `MIGRATED — ${levels.length} level(s) carried forward as version 1, ACTIVE.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ workflowType, outcome: `REFUSED — ${message}` });
    }
  }

  console.log('\n=== Backfill results ===');
  for (const r of results) {
    console.log(`${r.workflowType}: ${r.outcome}`);
  }

  const refused = results.filter((r) => r.outcome.startsWith('REFUSED'));
  if (refused.length > 0) {
    console.log(`\n${refused.length} workflow type(s) could NOT be migrated automatically — their old advisory configuration references a role that no longer holds the real approve permission for that domain. Re-grant the permission (or choose a different role) via Roles & Permissions, then re-run this script, or publish the definition manually through the Workflow Management UI with a valid role.`);
  }

  await app.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
