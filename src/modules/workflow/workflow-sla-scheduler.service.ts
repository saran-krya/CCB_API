import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { MailService } from '../../mail/mail.service';
import { workflowEscalationTemplate } from '../../mail/templates/workflow-escalation.template';
import { workflowSlaBreachTemplate } from '../../mail/templates/workflow-sla-breach.template';
import { NotificationChannel, NotificationPolicyService } from '../settings/notification-policy.service';
import { NotificationCategory } from '../settings/settings.constants';
import { User } from '../user/entities/user.entity';
import { UserRoleService } from '../user-role/user-role.service';
import { WorkflowDefinitionLevel } from './entities/workflow-definition-level.entity';
import { WorkflowInstance, WorkflowInstanceStatus } from './entities/workflow-instance.entity';
import { WorkflowInstanceStep } from './entities/workflow-instance-step.entity';
import { WorkflowOnBreach } from './entities/workflow-approval-level.entity';
import { WorkflowOrchestrationService } from './workflow-orchestration.service';
import { LOCK_MODE } from '../../common/constants/database.constants';
import { formatDateTimeForRecipient, RecipientRegional } from '../../common/utils/format-for-recipient.util';

const WORKFLOW_TYPE_LABELS: Record<string, string> = {
  TARIFF: 'Tariff',
  BILL_RUN: 'Bill Run',
  BILLING_CYCLE: 'Billing Cycle',
};

/** SLA notices to approvers are the "Approvals & workflow" notification category (Settings > Notifications) and go out by e-mail —
 *  the pair NotificationPolicyService is asked about before anything is sent. */
const SLA_NOTICE_CATEGORY: NotificationCategory = 'approvals';
const SLA_NOTICE_CHANNEL: NotificationChannel = 'email';

/** Renders and sends one notice to one approver. It receives that approver's own regional choices so the dates in the mail are
 *  written in their time zone and date layout (formatDateTimeForRecipient), never the server's. */
type ApproverMailSender = (address: string, regional: RecipientRegional) => Promise<{ sent: boolean; error?: string }>;

/** An approver the policy returned no regional entry for (not expected): dates then fall back to the built-in defaults. */
const NO_REGIONAL_CHOICE: RecipientRegional = { timeZone: null, dateFormat: null };

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
 *
 * NOTICES: NOTIFY e-mails the level's approvers that its deadline has passed; ESCALATE e-mails the NEXT level's approvers that
 * the item has reached them — a different message, because that level's own deadline is still ahead. Both go through
 * notifyApprovers: only holders of the level's role who could actually act on the item (not the submitter, not a SUPER_ADMIN
 * holder — the approve path refuses both), and of those only the ones NotificationPolicyService allows (the system e-mail switch
 * AND their own Approvals & workflow e-mail preference). A notice that is not allowed is simply not sent.
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
    private readonly notificationPolicy: NotificationPolicyService,
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
        await this.notifyBreach(step);
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
        .setLock(LOCK_MODE.PESSIMISTIC_WRITE)
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
    const escalated = await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .createQueryBuilder(WorkflowInstanceStep, 'wis')
        .setLock(LOCK_MODE.PESSIMISTIC_WRITE)
        .where('wis.id = :id', { id: step.id })
        .getOne();
      // Re-check under lock — flagBreach's own transaction already committed slaBreachedAt, but a
      // human could still have acted (approved/rejected) in the gap between that commit and this
      // transaction acquiring its own lock. Never escalate a step someone has since genuinely acted on.
      if (!locked || locked.action !== null) return false;
      await this.orchestration.recordEscalation(locked, manager);
      return true;
    });
    // Nothing was escalated (a human acted first): no notice, and no claim that an escalation happened.
    if (!escalated) return;

    const nextStep = await this.steps.findOne({
      where: { instanceId: step.instanceId, levelOrder: step.levelOrder + 1 },
      relations: { instance: true },
    });
    // Logged before the notice: the escalation is already committed, so a problem sending the notice is never reported as a failed escalation.
    this.logger.log(
      `Escalated workflow instance ${step.instanceId} (${step.instance.workflowType} #${step.instance.businessObjectId}) from Level ${step.levelOrder + 1} to Level ${step.levelOrder + 2} — SLA breached with no human action.`,
    );

    if (nextStep) {
      try {
        await this.notifyEscalation(step, nextStep);
      } catch (err) {
        this.logger.error(
          `Escalated workflow instance ${step.instanceId}, but the notice to the Level ${nextStep.levelOrder + 1} approvers could not be sent.`,
          err as Error,
        );
      }
    }
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

  /** NOTIFY — tells the level's approvers that its SLA deadline has passed. The step itself stays open and approvable. By
   *  construction the deadline HAS passed (the sweep only picks up steps whose slaDueAt is in the past), so the breach wording is
   *  exact. */
  private async notifyBreach(step: WorkflowInstanceStep): Promise<void> {
    const workflowTypeLabel = this.typeLabel(step);
    await this.notifyApprovers(step, (address, regional) =>
      this.mail.sendTemplate(address, workflowSlaBreachTemplate, {
        workflowTypeLabel,
        businessObjectId: step.instance.businessObjectId,
        levelOrder: step.levelOrder,
        slaDueLabel: formatDateTimeForRecipient(step.slaDueAt, regional),
      }),
    );
  }

  /** ESCALATE — tells the NEXT level's approvers that an item has reached them because the previous level missed its SLA. Not the
   *  breach notice: the next level was only just activated, so ITS deadline is still ahead and must never be described as
   *  passed. */
  private async notifyEscalation(breached: WorkflowInstanceStep, next: WorkflowInstanceStep): Promise<void> {
    const workflowTypeLabel = this.typeLabel(next);
    await this.notifyApprovers(next, (address, regional) =>
      this.mail.sendTemplate(address, workflowEscalationTemplate, {
        workflowTypeLabel,
        businessObjectId: next.instance.businessObjectId,
        fromLevelOrder: breached.levelOrder,
        toLevelOrder: next.levelOrder,
        newSlaDueLabel: formatDateTimeForRecipient(next.slaDueAt, regional),
      }),
    );
  }

  private typeLabel(step: WorkflowInstanceStep): string {
    return WORKFLOW_TYPE_LABELS[step.instance.workflowType] ?? step.instance.workflowType;
  }

  /** Mails one notice to the approvers of `step`'s level: the active holders of its role who could actually act on the item, and
   *  of those only the ones NotificationPolicyService allows (the system e-mail switch AND their own Approvals & workflow e-mail
   *  preference). `send` renders and sends the notice for one approver. A notice that is not allowed is simply not sent — never
   *  queued for later — and customer account e-mails never come through here. */
  private async notifyApprovers(step: WorkflowInstanceStep, send: ApproverMailSender): Promise<void> {
    const level = `workflow instance ${step.instanceId}, Level ${step.levelOrder + 1}`;

    // Active accounts only: a deactivated approver must not be mailed SLA notices.
    const holders = await this.userRoleService.getUsersByRoleId(step.roleId, true);
    if (holders.length === 0) {
      this.logger.warn(`SLA notice for ${level} — no user currently holds roleId ${step.roleId}, nobody to notify`);
      return;
    }

    const approverIds = await this.eligibleApproverIds(step, holders.map((holder) => holder.userId));
    if (approverIds.length === 0) {
      this.logger.warn(`SLA notice for ${level} — nobody holding roleId ${step.roleId} can act on it (the submitter and SUPER_ADMIN holders cannot approve), nobody to notify`);
      return;
    }

    const recipientIds = await this.notificationPolicy.allowedRecipients(SLA_NOTICE_CATEGORY, SLA_NOTICE_CHANNEL, approverIds);
    if (recipientIds.length < approverIds.length) {
      this.logger.debug(
        `SLA notice for ${level}: not sent to ${approverIds.length - recipientIds.length} of ${approverIds.length} approver(s) — e-mail notifications are switched off for the system or in their own preferences`,
      );
    }
    if (recipientIds.length === 0) return;

    const [userRows, regionalById] = await Promise.all([
      this.users.find({ where: { id: In(recipientIds) }, select: ['id', 'email'] }),
      this.notificationPolicy.resolveRegional(recipientIds),
    ]);

    for (const user of userRows) {
      const result = await send(user.email, regionalById.get(user.id) ?? NO_REGIONAL_CHOICE);
      if (!result.sent) {
        this.logger.error(`SLA notification failed for user ${user.id} (instance ${step.instanceId}): ${result.error}`);
      }
    }
  }

  /** Who could actually act on `step`: the holders of its role minus the people the approve path refuses anyway — the submitter
   *  (every domain's approve() runs assertNotSelfReview) and anyone holding SUPER_ADMIN, whatever else they hold
   *  (WorkflowOrchestrationService.assertCanAct). Told "an approval assigned to your role is overdue" they could do nothing
   *  about it. The SUPER_ADMIN question goes to UserRoleService.holdsSuperAdmin, the existing predicate, rather than being
   *  re-derived here. */
  private async eligibleApproverIds(step: WorkflowInstanceStep, holderIds: number[]): Promise<number[]> {
    const eligible: number[] = [];
    for (const userId of holderIds) {
      if (userId === step.instance.submittedById) continue;
      if (await this.userRoleService.holdsSuperAdmin(userId)) continue;
      eligible.push(userId);
    }
    return eligible;
  }
}
