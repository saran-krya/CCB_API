import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { MailService } from '../../mail/mail.service';
import { workflowSlaBreachTemplate } from '../../mail/templates/workflow-sla-breach.template';
import { User } from '../user/entities/user.entity';
import { UserRoleService } from '../user-role/user-role.service';
import { WorkflowDefinitionLevel } from './entities/workflow-definition-level.entity';
import { WorkflowInstance, WorkflowInstanceStatus } from './entities/workflow-instance.entity';
import { WorkflowInstanceStep } from './entities/workflow-instance-step.entity';
import { WorkflowOnBreach } from './entities/workflow-approval-level.entity';
import { WorkflowOrchestrationService } from './workflow-orchestration.service';

const WORKFLOW_TYPE_LABELS: Record<string, string> = {
  TARIFF: 'Tariff',
  BILL_RUN: 'Bill Run',
  BILLING_CYCLE: 'Billing Cycle',
};

/**
 * Hourly sweep for SLA deadlines that have passed on a still-open (unacted) workflow step —
 * mirrors TariffSchedulerService/BillingCycleSchedulerService's own shape (a plain @Cron provider
 * registered inside its own domain module, nothing centrally registered).
 *
 * A breach is flagged on the STEP, never on the instance or the underlying domain object: once
 * `slaDueAt` passes, the step's `slaBreachedAt` is set and the configured NOTIFY/ESCALATE/
 * AUTO_APPROVE action from `WorkflowDefinitionLevel.onBreach` (read ONCE, via the instance's own
 * write-once `definitionId` + the step's own `levelOrder` — never a live re-read of whatever the
 * CURRENT active definition happens to be, consistent with every other versioning guarantee in this
 * engine) runs.
 *
 * NOTIFY: the step itself is NEVER force-closed — `action` stays null, the level remains fully
 * approvable/rejectable exactly as before the breach; `slaBreachedAt` is purely an additional,
 * non-terminal flag surfaced to the UI (see WorkflowInstanceStep's own doc comment on why
 * SLA_BREACHED/ESCALATED are never recorded on the same row as APPROVED/REJECTED).
 *
 * ESCALATE: the current step is force-closed as ESCALATED (WorkflowOrchestrationService.
 * recordEscalation) and the next configured level becomes current. Unreachable on the final level
 * by construction — WorkflowDefinitionService.assertLevels refuses to save ESCALATE there at
 * publish time — but this code defends against it anyway (recordEscalation throws rather than
 * inventing a level) in case an instance is still running against an OLDER definition version that
 * validly had a level after this one at the time it was published.
 *
 * AUTO_APPROVE: calls the real domain's own approve() method (Tariff/BillRun/BillingCycle) with
 * isSystemActor=true, reusing 100% of that domain's real approval logic — including, at the final
 * level, whatever real side effect that domain's final approval triggers (Tariff -> ACTIVE, Billing
 * Cycle -> activateVersion/possible immediate activation, Bill Run -> generateBillsForBillRun).
 * Reached via WorkflowOrchestrationService.invokeAutoApproveHandler — a registry each domain service
 * populates from its own constructor — rather than injecting TariffService/BillRunService/
 * BillingCycleService here directly: that direct-injection shape required WorkflowModule to import
 * all three domain modules, which (since all three already import WorkflowModule for
 * WorkflowOrchestrationService) is circular, and cascaded into several OTHER pre-existing module
 * cycles elsewhere in this codebase's graph (confirmed live via NestJS's own "module at index [N] is
 * undefined" bootstrap error). The registry keeps the dependency direction every other edge in this
 * module graph already uses — domain -> workflow, never reversed — so no module-level import is
 * needed here at all.
 */
@Injectable()
export class WorkflowSlaSchedulerService {
  private readonly logger = new Logger(WorkflowSlaSchedulerService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkflowInstanceStep) private readonly steps: Repository<WorkflowInstanceStep>,
    @InjectRepository(WorkflowDefinitionLevel) private readonly definitionLevels: Repository<WorkflowDefinitionLevel>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly userRoleService: UserRoleService,
    private readonly mail: MailService,
    private readonly orchestration: WorkflowOrchestrationService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    const breached = await this.processBreachedSteps();
    if (breached > 0) {
      this.logger.log(`Processed ${breached} newly-breached workflow SLA step(s)`);
    }
  }

  async processBreachedSteps(): Promise<number> {
    const now = new Date();

    // Open, overdue, not-yet-flagged steps whose PARENT instance is still actually waiting — a step
    // can be overdue on a now-REJECTED/CANCELLED instance if that instance ended via a different
    // level (impossible today since there is only ever one open step at a time per instance, but the
    // join guards against it regardless of how the instance ended).
    const dueSteps = await this.steps.find({
      where: { slaDueAt: LessThanOrEqual(now), slaBreachedAt: IsNull(), action: IsNull() },
      relations: { instance: true },
    });

    let processed = 0;
    for (const step of dueSteps) {
      if (step.instance?.status !== WorkflowInstanceStatus.WAITING_FOR_APPROVAL) continue;
      const didBreach = await this.breachOneStep(step);
      if (didBreach) processed++;
    }
    return processed;
  }

  /** Flags the breach (locked, idempotent — see breachOneStep's own doc comment), THEN — outside
   *  that same short transaction — dispatches to the configured on-breach action. ESCALATE and
   *  AUTO_APPROVE each run in their OWN transaction (recordEscalation, and the domain's own
   *  approve() which already wraps itself in a transaction) rather than being nested inside the
   *  breach-flagging transaction, for the same reason BillRunService.approve() calls
   *  generateBillsForBillRun() after its own transaction commits: these are independent,
   *  consequential state changes that must not silently roll back together with the simple
   *  "mark this step breached" flag if one of them throws. A failure dispatching the configured
   *  action is logged, never left to crash the whole hourly sweep for every other due step. */
  private async breachOneStep(step: WorkflowInstanceStep): Promise<boolean> {
    const flagged = await this.flagBreach(step);
    if (!flagged) return false;

    const level = await this.definitionLevels.findOne({
      where: { definitionId: step.instance.definitionId, levelOrder: step.levelOrder },
    });
    const onBreach = level?.onBreach ?? WorkflowOnBreach.NOTIFY;

    try {
      if (onBreach === WorkflowOnBreach.AUTO_APPROVE) {
        await this.autoApprove(step);
      } else if (onBreach === WorkflowOnBreach.ESCALATE) {
        await this.escalate(step);
      } else {
        await this.notifyApprovers(step);
      }
    } catch (err) {
      this.logger.error(
        `Failed to process on-breach action ${onBreach} for workflow instance ${step.instanceId} (${step.instance.workflowType} #${step.instance.businessObjectId}, Level ${step.levelOrder + 1}) — the breach itself IS flagged (slaBreachedAt is set), but the configured action did not complete. Will NOT retry automatically until the next hourly sweep re-evaluates (slaBreachedAt is already set, so this exact step will not be picked up again — requires manual intervention if this keeps failing).`,
        err as Error,
      );
      return true;
    }
    return true;
  }

  /** One step at a time, each in its own short transaction with a lock on just that step row —
   *  mirrors WorkflowOrchestrationService.assertCanAct's own "lock by primary key only, never by a
   *  non-unique compound predicate" rule (see that method's own doc comment on the gap-lock deadlock
   *  this avoids). If a human approves/rejects this exact step between the unlocked find() above and
   *  this lock being acquired, the re-read inside the lock will see `action` already set and this
   *  step is correctly skipped — never double-flagged, never racing a real approval. Returns false
   *  if the step was already breached/acted upon by the time the lock was acquired (idempotent —
   *  re-running the sweep, or two overlapping sweeps, can never flag or dispatch twice). */
  private async flagBreach(step: WorkflowInstanceStep): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .createQueryBuilder(WorkflowInstanceStep, 'wis')
        .setLock('pessimistic_write')
        .where('wis.id = :id', { id: step.id })
        .getOne();
      if (!locked || locked.slaBreachedAt !== null || locked.action !== null) return false;

      locked.slaBreachedAt = new Date();
      await manager.save(WorkflowInstanceStep, locked);
      return true;
    });
  }

  /** ESCALATE — force-closes the current step as ESCALATED and activates the next level. See
   *  WorkflowOrchestrationService.recordEscalation's own doc comment for the full contract
   *  (never touches the domain object's status; never completes the instance). */
  private async escalate(step: WorkflowInstanceStep): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .createQueryBuilder(WorkflowInstanceStep, 'wis')
        .setLock('pessimistic_write')
        .where('wis.id = :id', { id: step.id })
        .getOne();
      // Re-check under lock — flagBreach's own transaction already committed slaBreachedAt, but a
      // human could still have acted (approved/rejected) in the gap between that commit and this
      // transaction acquiring its own lock. Never escalate a step someone has since genuinely acted on.
      if (!locked || locked.action !== null) return;
      await this.orchestration.recordEscalation(locked, manager);
    });

    const nextStep = await this.steps.findOne({
      where: { instanceId: step.instanceId, levelOrder: step.levelOrder + 1 },
      relations: { instance: true },
    });
    if (nextStep) await this.notifyApprovers(nextStep);

    this.logger.log(
      `Escalated workflow instance ${step.instanceId} (${step.instance.workflowType} #${step.instance.businessObjectId}) from Level ${step.levelOrder + 1} to Level ${step.levelOrder + 2} — SLA breached with no human action.`,
    );
  }

  /** AUTO_APPROVE — calls the real domain's own approve() (via WorkflowOrchestrationService's
   *  handler registry — see that service's own doc comment, and this class's own doc comment above)
   *  with isSystemActor=true. Each domain's approve() independently re-validates everything it
   *  always has (row lock, status check, workflow's own assertCanAct — now with isSystemActor=true
   *  bypassing only the human role-match, see that method's own doc comment) — this method does not
   *  duplicate any of that validation, it only routes to the correct domain's registered handler. */
  private async autoApprove(step: WorkflowInstanceStep): Promise<void> {
    const { workflowType, businessObjectId } = step.instance;
    await this.orchestration.invokeAutoApproveHandler(workflowType, businessObjectId);

    this.logger.log(
      `Auto-approved workflow instance ${step.instanceId} (${workflowType} #${businessObjectId}) at Level ${step.levelOrder + 1} — SLA breached with no human action.`,
    );
  }

  private async notifyApprovers(step: WorkflowInstanceStep): Promise<void> {
    const approvers = await this.userRoleService.getUsersByRoleId(step.roleId);
    if (approvers.length === 0) {
      this.logger.warn(`SLA breach on workflow instance ${step.instanceId}, Level ${step.levelOrder + 1} — no user currently holds roleId ${step.roleId}, nobody to notify`);
      return;
    }

    const userRows = await this.users.find({ where: { id: In(approvers.map((a) => a.userId)) }, select: ['id', 'email'] });
    const workflowTypeLabel = WORKFLOW_TYPE_LABELS[step.instance.workflowType] ?? step.instance.workflowType;

    for (const user of userRows) {
      const result = await this.mail.sendTemplate(user.email, workflowSlaBreachTemplate, {
        workflowTypeLabel,
        businessObjectId: step.instance.businessObjectId,
        levelOrder: step.levelOrder,
        slaDueAt: step.slaDueAt!,
      });
      if (!result.sent) {
        this.logger.error(`SLA breach notification failed for user ${user.id} (instance ${step.instanceId}): ${result.error}`);
      }
    }
  }
}
