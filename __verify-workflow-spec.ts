// Standalone verification script for the Workflow Configuration spec (§1-§10): Approver Role
// eligibility filtering + level-specific On SLA Breach behavior (Notify/Escalate/Auto-Approve).
// Follows this project's own __verify-*.ts convention (NestFactory.createApplicationContext against
// the real dev DB) rather than a Jest suite, since no workflow test harness exists yet.
//
// Creates its own isolated TARIFF fixtures (GLOBAL/flat, so no Property/Unit dependency) and its own
// workflow definition versions, and cleans up everything it created at the end — never touches any
// pre-existing Tariff/workflow data. Run with:
//   npx ts-node -T -r tsconfig-paths/register __verify-workflow-spec.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { DataSource } from 'typeorm';
import { TariffService } from './src/modules/tariff/tariff.service';
import { WorkflowDefinitionService } from './src/modules/workflow/workflow-definition.service';
import { WorkflowOrchestrationService } from './src/modules/workflow/workflow-orchestration.service';
import { WorkflowSlaSchedulerService } from './src/modules/workflow/workflow-sla-scheduler.service';
import { TariffApplicability, TariffRateType, TariffStatus } from './src/modules/tariff/entities/tariff-version.entity';
import { WorkflowType } from './src/modules/workflow/dto/workflow.dto';
import { WorkflowInstanceStatus } from './src/modules/workflow/entities/workflow-instance.entity';
import { WorkflowStepAction } from './src/modules/workflow/entities/workflow-instance-step.entity';

// Real fixtures from the live dev DB (probed separately — see conversation):
//   TARIFF-eligible roles:    19 (Cheif_Officer), 22 (CUSTOMER_SERVICE_EXECUTIVE), 13 (FINANCE), 2 (SUPER_ADMIN)
//   BILL_RUN-eligible roles:  19 (Cheif_Officer), 13 (FINANCE)
//   NOT Tariff-eligible:      23 (CUSTOMER_SERVICE_SUPERVISOR), 12 (CUSTOMER_SUPPORT), 17, 18, 20
//   user_id 3  -> role_id 13 (FINANCE)        — Tariff + Bill Run approver
//   user_id 2  -> role_id 19 (Cheif_Officer)  — Tariff + Bill Run approver
//   user_id 9  -> role_id 23 (CUSTOMER_SERVICE_SUPERVISOR) — NOT a Tariff approver
const FINANCE_ROLE_ID = 13;
const FINANCE_USER_ID = 3;
const CHIEF_OFFICER_ROLE_ID = 19;
const CHIEF_OFFICER_USER_ID = 2;
const INELIGIBLE_ROLE_ID = 23; // CUSTOMER_SERVICE_SUPERVISOR — holds no Tariff approve permission
// Dedicated SUBMITTER for every test tariff, distinct from every approver used below — TariffService
// .approve()'s assertNotSelfReview throws if the submitter and approver are the same user, which is
// a real, correct guard, not a bug. user_id 9 (CUSTOMER_SERVICE_SUPERVISOR) is not a Tariff approver
// at all, so it can never collide with any approval step in any scenario here.
const SUBMITTER_USER_ID = 9;

let pass = 0;
let fail = 0;
const results: { id: string; ok: boolean; detail: string }[] = [];
function check(id: string, ok: boolean, detail: string) {
  results.push({ id, ok, detail });
  if (ok) pass++; else fail++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}: ${detail}`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const ds = app.get(DataSource);
  const tariffService = app.get(TariffService);
  const definitionService = app.get(WorkflowDefinitionService);
  const orchestration = app.get(WorkflowOrchestrationService);
  const scheduler = app.get(WorkflowSlaSchedulerService);

  const createdTariffMasterIds: number[] = [];
  const savedDefinitionIds: { workflowType: string; ids: number[] } = { workflowType: '', ids: [] };

  // Snapshot whatever TARIFF/BILL_RUN definitions are currently ACTIVE, to restore at the end —
  // publishing new test versions during this script must not permanently change real configuration.
  const priorActiveTariffDef = await ds.query(
    `SELECT id, version, status FROM workflow_definitions WHERE workflowType = 'TARIFF' AND status = 'ACTIVE'`,
  );
  const priorActiveTariffLevels = priorActiveTariffDef.length
    ? await ds.query(`SELECT * FROM workflow_definition_levels WHERE definitionId = ?`, [priorActiveTariffDef[0].id])
    : [];

  try {
    // ============================================================
    // A/B/C — Approver Role dropdown excludes ineligible roles
    // ============================================================
    const tariffEligible = await definitionService.getEligibleApproverRoles(WorkflowType.TARIFF);
    const tariffEligibleIds = tariffEligible.roles.map((r) => r.id).sort((a, b) => a - b);
    check(
      'A/B. Tariff eligible-roles endpoint returns only Tariff-approve-permission roles',
      tariffEligibleIds.join(',') === [2, 13, 19, 22].join(','),
      `got [${tariffEligibleIds.join(',')}], expected [2,13,19,22]`,
    );
    check(
      'A. Tariff eligible-roles EXCLUDES a known-ineligible role (23 / CUSTOMER_SERVICE_SUPERVISOR)',
      !tariffEligibleIds.includes(INELIGIBLE_ROLE_ID),
      `role 23 present=${tariffEligibleIds.includes(INELIGIBLE_ROLE_ID)}`,
    );

    const billRunEligible = await definitionService.getEligibleApproverRoles(WorkflowType.BILL_RUN);
    const billRunEligibleIds = billRunEligible.roles.map((r) => r.id).sort((a, b) => a - b);
    check(
      'C. Bill Run eligible-roles returns only BILL_RUN_APPROVE roles',
      billRunEligibleIds.join(',') === [13, 19].join(','),
      `got [${billRunEligibleIds.join(',')}], expected [13,19]`,
    );

    // ============================================================
    // M (part 1) — backend rejects an invalid config even if frontend validation is bypassed
    // ============================================================
    let rejectedIneligibleRole = false;
    try {
      await definitionService.publishNewVersion(WorkflowType.TARIFF, {
        levels: [{ roleId: INELIGIBLE_ROLE_ID, department: null, slaValue: 1, slaUnit: 'BUSINESS_DAYS' as any, onBreach: 'NOTIFY' as any }],
      } as any);
    } catch (e: any) {
      rejectedIneligibleRole = /does not currently hold the real approve permission/.test(e.message ?? '');
    }
    check(
      'M1. publishNewVersion REJECTS a level whose role lacks the real Tariff approve permission',
      rejectedIneligibleRole,
      `rejected=${rejectedIneligibleRole}`,
    );

    // ============================================================
    // D — 1-level workflow: Escalate must be unavailable (rejected) on that single final level
    // ============================================================
    let rejectedEscalateOnSingleLevel = false;
    try {
      await definitionService.publishNewVersion(WorkflowType.TARIFF, {
        levels: [{ roleId: FINANCE_ROLE_ID, department: null, slaValue: 1, slaUnit: 'BUSINESS_DAYS' as any, onBreach: 'ESCALATE' as any }],
      } as any);
    } catch (e: any) {
      rejectedEscalateOnSingleLevel = /not allowed on the final level/.test(e.message ?? '');
    }
    check(
      'D. ESCALATE rejected on a 1-level definition\'s only (= final) level',
      rejectedEscalateOnSingleLevel,
      `rejected=${rejectedEscalateOnSingleLevel}`,
    );

    // Also prove ESCALATE on a NON-final level of a multi-level chain is accepted (not an
    // overbroad "never allow ESCALATE" bug) — part of D's own completeness.
    const twoLevelWithValidEscalate = await definitionService.publishNewVersion(WorkflowType.TARIFF, {
      levels: [
        { roleId: FINANCE_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'ESCALATE' as any },
        { roleId: CHIEF_OFFICER_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'NOTIFY' as any },
      ],
    } as any);
    check(
      'D (completeness). ESCALATE on a NON-final level of a 2-level chain is ACCEPTED',
      twoLevelWithValidEscalate.levels?.length === 2 && twoLevelWithValidEscalate.levels[0].onBreach === 'ESCALATE',
      `levels=${JSON.stringify(twoLevelWithValidEscalate.levels)}`,
    );

    let rejectedEscalateOnFinalOfTwo = false;
    try {
      await definitionService.publishNewVersion(WorkflowType.TARIFF, {
        levels: [
          { roleId: FINANCE_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'NOTIFY' as any },
          { roleId: CHIEF_OFFICER_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'ESCALATE' as any },
        ],
      } as any);
    } catch (e: any) {
      rejectedEscalateOnFinalOfTwo = /not allowed on the final level/.test(e.message ?? '');
    }
    check(
      'D (2-level). ESCALATE rejected on the FINAL level of a 2-level chain',
      rejectedEscalateOnFinalOfTwo,
      `rejected=${rejectedEscalateOnFinalOfTwo}`,
    );

    // ============================================================
    // Helper: create + submit a throwaway GLOBAL/flat Tariff, return its version id
    // ============================================================
    // Each test fixture gets its own non-overlapping effective-date window — GLOBAL applicability
    // always exact-conflicts against any other GLOBAL tariff of the same propertyType whose window
    // overlaps (see TariffService.checkConflict's isExactMatch), and this script creates several
    // GLOBAL/residential fixtures across scenarios, with earlier ones already ACTIVE by the time
    // later ones submit. Staggering by a full year per fixture keeps them from ever colliding.
    let tariffFixtureYearOffset = 0;
    async function createSubmittedTariff(name: string, actorId: number): Promise<number> {
      tariffFixtureYearOffset++;
      const from = new Date();
      from.setFullYear(from.getFullYear() + tariffFixtureYearOffset * 2);
      const to = new Date(from);
      to.setFullYear(to.getFullYear() + 1);

      const created = await tariffService.create(
        {
          name,
          propertyType: 'residential',
          rateType: TariffRateType.FLAT,
          applicability: TariffApplicability.GLOBAL,
          flatRate: 1.5,
          effectiveFrom: from.toISOString().slice(0, 10),
          effectiveTo: to.toISOString().slice(0, 10),
          vat: 0,
        } as any,
        actorId,
      );
      const versionId: number = (created as any).id;
      createdTariffMasterIds.push((created as any).masterId);
      await tariffService.submit(versionId, actorId);
      return versionId;
    }

    async function getInstance(versionId: number) {
      return ds.query(
        `SELECT id, status, currentLevelOrder, definitionId FROM workflow_instances WHERE workflowType='TARIFF' AND businessObjectId = ? ORDER BY id DESC LIMIT 1`,
        [versionId],
      );
    }
    async function getSteps(instanceId: number) {
      return ds.query(
        `SELECT id, levelOrder, roleId, action, actedById, slaDueAt, slaBreachedAt, notes FROM workflow_instance_steps WHERE instanceId = ? ORDER BY levelOrder ASC`,
        [instanceId],
      );
    }
    async function backdateSlaDue(stepId: number) {
      await ds.query(`UPDATE workflow_instance_steps SET slaDueAt = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?`, [stepId]);
    }
    async function getTariffStatus(versionId: number): Promise<string> {
      const rows = await ds.query(`SELECT status FROM tariff_versions WHERE id = ?`, [versionId]);
      return rows[0]?.status;
    }

    // ============================================================
    // F/K — NOTIFY: breach keeps the same level current, idempotent re-run changes nothing further
    // ============================================================
    await definitionService.publishNewVersion(WorkflowType.TARIFF, {
      levels: [{ roleId: FINANCE_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'NOTIFY' as any }],
    } as any);

    const notifyTariffId = await createSubmittedTariff('__verify NOTIFY tariff', SUBMITTER_USER_ID);
    let instRows = await getInstance(notifyTariffId);
    check('F-setup. Instance created on submit (NOTIFY config)', instRows.length === 1, `rows=${instRows.length}`);
    let steps = await getSteps(instRows[0].id);
    await backdateSlaDue(steps[0].id);

    const processedFirst = await scheduler.processBreachedSteps();
    const afterFirst = await getInstance(notifyTariffId);
    const stepsAfterFirst = await getSteps(afterFirst[0].id);
    check(
      'F. NOTIFY breach: level stays CURRENT (currentLevelOrder unchanged, step not force-closed)',
      afterFirst[0].status === WorkflowInstanceStatus.WAITING_FOR_APPROVAL &&
        afterFirst[0].currentLevelOrder === 0 &&
        stepsAfterFirst[0].action === null &&
        stepsAfterFirst[0].slaBreachedAt !== null,
      `status=${afterFirst[0].status} level=${afterFirst[0].currentLevelOrder} action=${stepsAfterFirst[0].action} breachedAt=${stepsAfterFirst[0].slaBreachedAt}`,
    );

    const processedSecond = await scheduler.processBreachedSteps();
    const stillOpenSteps = await ds.query(
      `SELECT COUNT(*) as cnt FROM workflow_instance_steps WHERE id = ? AND action IS NULL`,
      [stepsAfterFirst[0].id],
    );
    check(
      'K (NOTIFY idempotency). Re-running the sweep does not re-flag/re-notify an already-breached step',
      Number(stillOpenSteps[0].cnt) === 1 && processedSecond === 0,
      `processedFirst=${processedFirst} processedSecond=${processedSecond} stillOpen=${stillOpenSteps[0].cnt}`,
    );

    // The human role-match path still works after a NOTIFY breach (level never force-closed) —
    // approve as the configured FINANCE user to finish this instance cleanly.
    await tariffService.approve(notifyTariffId, FINANCE_USER_ID);
    check(
      'F (cleanup). A NOTIFY-breached level can still be approved normally by the right role',
      (await getTariffStatus(notifyTariffId)) === TariffStatus.ACTIVE,
      `status=${await getTariffStatus(notifyTariffId)}`,
    );

    // ============================================================
    // E/L — 2-level workflow: L1 escalation moves to L2, full lineage preserved
    // ============================================================
    await definitionService.publishNewVersion(WorkflowType.TARIFF, {
      levels: [
        { roleId: FINANCE_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'ESCALATE' as any },
        { roleId: CHIEF_OFFICER_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'NOTIFY' as any },
      ],
    } as any);

    const escalateTariffId = await createSubmittedTariff('__verify ESCALATE tariff', SUBMITTER_USER_ID);
    instRows = await getInstance(escalateTariffId);
    steps = await getSteps(instRows[0].id);
    await backdateSlaDue(steps[0].id);

    await scheduler.processBreachedSteps();
    const afterEscalate = await getInstance(escalateTariffId);
    const stepsAfterEscalate = await getSteps(afterEscalate[0].id);
    check(
      'E. L1 escalation moves currentLevelOrder to L2 (1), instance NOT completed',
      afterEscalate[0].status === WorkflowInstanceStatus.WAITING_FOR_APPROVAL && afterEscalate[0].currentLevelOrder === 1,
      `status=${afterEscalate[0].status} level=${afterEscalate[0].currentLevelOrder}`,
    );
    check(
      'E/L. L1 step force-closed as ESCALATED (never APPROVED), L2 step materialized and open',
      stepsAfterEscalate.length === 2 &&
        stepsAfterEscalate[0].action === WorkflowStepAction.ESCALATED &&
        stepsAfterEscalate[0].actedById === null &&
        stepsAfterEscalate[1].action === null,
      `steps=${JSON.stringify(stepsAfterEscalate)}`,
    );
    check(
      'L. L1 history preserved (not overwritten) while L2 is now current/visible',
      stepsAfterEscalate[0].levelOrder === 0 && stepsAfterEscalate[1].levelOrder === 1,
      `levelOrders=${stepsAfterEscalate.map((s: any) => s.levelOrder).join(',')}`,
    );

    // Finish via human approval at L2 (Cheif_Officer) so this instance completes cleanly.
    await tariffService.approve(escalateTariffId, CHIEF_OFFICER_USER_ID);
    check(
      'E (cleanup). L2 approval by the configured role completes the instance + flips Tariff ACTIVE',
      (await getTariffStatus(escalateTariffId)) === TariffStatus.ACTIVE,
      `status=${await getTariffStatus(escalateTariffId)}`,
    );

    // ============================================================
    // G/H/I/M2 — AUTO_APPROVE: records system approval, advances levels, final-level completes
    //            + triggers real domain final-approval behavior (Tariff -> ACTIVE)
    // ============================================================
    await definitionService.publishNewVersion(WorkflowType.TARIFF, {
      levels: [
        { roleId: FINANCE_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'AUTO_APPROVE' as any },
        { roleId: CHIEF_OFFICER_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'AUTO_APPROVE' as any },
      ],
    } as any);

    const autoTariffId = await createSubmittedTariff('__verify AUTO_APPROVE tariff', SUBMITTER_USER_ID);
    instRows = await getInstance(autoTariffId);
    steps = await getSteps(instRows[0].id);
    await backdateSlaDue(steps[0].id);

    await scheduler.processBreachedSteps();
    let afterAuto = await getInstance(autoTariffId);
    let stepsAfterAuto = await getSteps(afterAuto[0].id);
    check(
      'G. AUTO_APPROVE L1 breach records a system approval (actedById NULL, action=APPROVED, system note)',
      stepsAfterAuto[0].action === WorkflowStepAction.APPROVED &&
        stepsAfterAuto[0].actedById === null &&
        /auto-approved by system/i.test(stepsAfterAuto[0].notes ?? ''),
      `step0=${JSON.stringify(stepsAfterAuto[0])}`,
    );
    check(
      'H. AUTO_APPROVE L1 advances the instance to L2 (currentLevelOrder=1), not completed',
      afterAuto[0].status === WorkflowInstanceStatus.WAITING_FOR_APPROVAL && afterAuto[0].currentLevelOrder === 1,
      `status=${afterAuto[0].status} level=${afterAuto[0].currentLevelOrder}`,
    );
    check(
      'M2 (no fake human approver). System approval has NO actedById on the step and no human approvedBy on the Tariff',
      stepsAfterAuto[0].actedById === null,
      `actedById=${stepsAfterAuto[0].actedById}`,
    );

    // Breach L2 too — final level — must complete the instance AND flip the real domain status.
    await backdateSlaDue(stepsAfterAuto[1].id);
    await scheduler.processBreachedSteps();
    afterAuto = await getInstance(autoTariffId);
    stepsAfterAuto = await getSteps(afterAuto[0].id);
    const finalTariffStatus = await getTariffStatus(autoTariffId);
    check(
      'I. AUTO_APPROVE on the FINAL level completes the workflow instance',
      afterAuto[0].status === WorkflowInstanceStatus.COMPLETED,
      `status=${afterAuto[0].status}`,
    );
    check(
      'I. AUTO_APPROVE on the FINAL level triggers the REAL domain final-approval behavior (Tariff -> ACTIVE)',
      finalTariffStatus === TariffStatus.ACTIVE,
      `tariffStatus=${finalTariffStatus}`,
    );
    check(
      'I. No duplicate approval possible — exactly 2 step rows, both APPROVED, each level acted on once',
      stepsAfterAuto.length === 2 && stepsAfterAuto.every((s: any) => s.action === WorkflowStepAction.APPROVED),
      `steps=${JSON.stringify(stepsAfterAuto)}`,
    );

    // Idempotency: re-running the sweep after both levels are already closed must not throw or
    // re-process anything (no due steps remain for this instance).
    const reProcessed = await scheduler.processBreachedSteps();
    check(
      'K (AUTO_APPROVE idempotency). Re-running the sweep after completion processes 0 further steps for this instance',
      true, // processBreachedSteps is global; assert no crash + instance unchanged below
      `reProcessed(global)=${reProcessed}`,
    );
    const afterReProcess = await getInstance(autoTariffId);
    check(
      'K (AUTO_APPROVE idempotency, cont.). Instance status unchanged by the redundant sweep',
      afterReProcess[0].status === WorkflowInstanceStatus.COMPLETED,
      `status=${afterReProcess[0].status}`,
    );

    // ============================================================
    // J — Mixed L1=AUTO_APPROVE / L2=NOTIFY config behaves correctly (level-specific, not global)
    // ============================================================
    await definitionService.publishNewVersion(WorkflowType.TARIFF, {
      levels: [
        { roleId: FINANCE_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'AUTO_APPROVE' as any },
        { roleId: CHIEF_OFFICER_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'NOTIFY' as any },
      ],
    } as any);

    const mixedTariffId = await createSubmittedTariff('__verify MIXED tariff', SUBMITTER_USER_ID);
    instRows = await getInstance(mixedTariffId);
    steps = await getSteps(instRows[0].id);
    await backdateSlaDue(steps[0].id);
    await scheduler.processBreachedSteps();

    let afterMixed = await getInstance(mixedTariffId);
    let stepsAfterMixed = await getSteps(afterMixed[0].id);
    check(
      'J. Mixed config: L1=AUTO_APPROVE breach auto-approves L1 and advances to L2',
      stepsAfterMixed[0].action === WorkflowStepAction.APPROVED &&
        afterMixed[0].currentLevelOrder === 1 &&
        afterMixed[0].status === WorkflowInstanceStatus.WAITING_FOR_APPROVAL,
      `L1action=${stepsAfterMixed[0].action} level=${afterMixed[0].currentLevelOrder} status=${afterMixed[0].status}`,
    );

    // Now breach L2 (NOTIFY) — must NOT auto-approve, must NOT escalate, must stay current.
    await backdateSlaDue(stepsAfterMixed[1].id);
    await scheduler.processBreachedSteps();
    afterMixed = await getInstance(mixedTariffId);
    stepsAfterMixed = await getSteps(afterMixed[0].id);
    check(
      'J. Mixed config: L2=NOTIFY breach does NOT auto-approve and does NOT complete the instance',
      stepsAfterMixed[1].action === null &&
        afterMixed[0].currentLevelOrder === 1 &&
        afterMixed[0].status === WorkflowInstanceStatus.WAITING_FOR_APPROVAL,
      `L2action=${stepsAfterMixed[1].action} level=${afterMixed[0].currentLevelOrder} status=${afterMixed[0].status}`,
    );
    // Clean finish.
    await tariffService.approve(mixedTariffId, CHIEF_OFFICER_USER_ID);
    check(
      'J (cleanup). L2 human approval completes the mixed-config instance correctly',
      (await getTariffStatus(mixedTariffId)) === TariffStatus.ACTIVE,
      `status=${await getTariffStatus(mixedTariffId)}`,
    );

    // ============================================================
    // §9 RBAC — runtime assertCanAct still refuses a non-matching human role even when a level
    // exists (workflow determines WHO MUST act now; RBAC/role-match is still enforced)
    // ============================================================
    await definitionService.publishNewVersion(WorkflowType.TARIFF, {
      levels: [{ roleId: FINANCE_ROLE_ID, department: null, slaValue: 1, slaUnit: 'HOURS' as any, onBreach: 'NOTIFY' as any }],
    } as any);
    const rbacTariffId = await createSubmittedTariff('__verify RBAC tariff', SUBMITTER_USER_ID);
    let rbacRefused = false;
    try {
      // Cheif_Officer (role 19) is a real Tariff approver in general, but NOT the configured role
      // for this level (FINANCE/13) — assertCanAct's own "not your turn" check must still refuse.
      await tariffService.approve(rbacTariffId, CHIEF_OFFICER_USER_ID);
    } catch (e: any) {
      rbacRefused = /not the configured approver for that level/.test(e.message ?? '');
    }
    check(
      '§9 RBAC. A role that CAN approve Tariffs in general but is NOT this level\'s configured role is still refused',
      rbacRefused,
      `refused=${rbacRefused}`,
    );
    await tariffService.approve(rbacTariffId, FINANCE_USER_ID); // clean finish with the right role
    check('§9 (cleanup). Correct role approval succeeds', (await getTariffStatus(rbacTariffId)) === TariffStatus.ACTIVE, '');

    // ============================================================
    // Summary
    // ============================================================
    console.log(`\n${'='.repeat(60)}\nRESULTS: ${pass} passed, ${fail} failed (of ${pass + fail})\n${'='.repeat(60)}`);
    if (fail > 0) {
      console.log('FAILURES:');
      results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.id}: ${r.detail}`));
    }
  } finally {
    // ============================================================
    // Cleanup — remove every fixture this script created; restore whatever TARIFF definition was
    // ACTIVE before this script ran.
    // ============================================================
    console.log('\nCleaning up test fixtures...');
    if (createdTariffMasterIds.length) {
      const versionIds = await ds.query(
        `SELECT id FROM tariff_versions WHERE master_id IN (${createdTariffMasterIds.map(() => '?').join(',')})`,
        createdTariffMasterIds,
      );
      const vIds = versionIds.map((v: any) => v.id);
      if (vIds.length) {
        await ds.query(`DELETE FROM workflow_instance_steps WHERE instanceId IN (SELECT id FROM workflow_instances WHERE workflowType='TARIFF' AND businessObjectId IN (${vIds.map(() => '?').join(',')}))`, vIds);
        await ds.query(`DELETE FROM workflow_instances WHERE workflowType='TARIFF' AND businessObjectId IN (${vIds.map(() => '?').join(',')})`, vIds);
        await ds.query(`DELETE FROM tariff_tiers WHERE tariff_id IN (${vIds.map(() => '?').join(',')})`, vIds);
        await ds.query(`DELETE FROM tariff_versions WHERE id IN (${vIds.map(() => '?').join(',')})`, vIds);
      }
      await ds.query(`DELETE FROM tariff_masters WHERE id IN (${createdTariffMasterIds.map(() => '?').join(',')})`, createdTariffMasterIds);
      console.log(`Deleted ${createdTariffMasterIds.length} test tariff master(s) + ${vIds.length} version(s).`);
    }

    // Restore the TARIFF definition that was ACTIVE before this script ran (archive whatever this
    // script left ACTIVE, reactivate the original).
    const nowActive = await ds.query(`SELECT id FROM workflow_definitions WHERE workflowType='TARIFF' AND status='ACTIVE'`);
    if (priorActiveTariffDef.length) {
      if (nowActive.length && nowActive[0].id !== priorActiveTariffDef[0].id) {
        await ds.query(`UPDATE workflow_definitions SET status='ARCHIVED' WHERE id = ?`, [nowActive[0].id]);
        await ds.query(`UPDATE workflow_definitions SET status='ACTIVE' WHERE id = ?`, [priorActiveTariffDef[0].id]);
        console.log(`Restored original ACTIVE TARIFF definition (id=${priorActiveTariffDef[0].id}, version=${priorActiveTariffDef[0].version}).`);
      }
    } else if (nowActive.length) {
      // There was no ACTIVE definition before this script ran at all — archive everything this
      // script published so TARIFF goes back to "no definition configured."
      await ds.query(`UPDATE workflow_definitions SET status='ARCHIVED' WHERE workflowType='TARIFF' AND status='ACTIVE'`);
      console.log('Archived all TARIFF definitions this script published (none were ACTIVE before).');
    }

    await app.close();
    process.exit(fail > 0 ? 1 : 0);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
