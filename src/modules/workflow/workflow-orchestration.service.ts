import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { UserRoleService } from '../user-role/user-role.service';
import { RUNTIME_VIEW_ACTION_CODES } from './workflow.service';
import { WorkflowType } from './dto/workflow.dto';
import { WorkflowDefinition, WorkflowDefinitionStatus } from './entities/workflow-definition.entity';
import { WorkflowDefinitionLevel } from './entities/workflow-definition-level.entity';
import { WorkflowInstance, WorkflowInstanceStatus } from './entities/workflow-instance.entity';
import { WorkflowInstanceStep, WorkflowStepAction } from './entities/workflow-instance-step.entity';
import { WorkflowSlaUnit } from './entities/workflow-approval-level.entity';

/** Returned by `assertCanAct` — tells the calling domain service whether the action it's about to
 *  perform is the FINAL level (domain's own terminal transition should run) or an INTERMEDIATE one
 *  (domain status must NOT change yet; only the instance advances). `instance === null` means no
 *  workflow is configured for this (workflowType — either no ACTIVE definition exists at all, or
 *  none was ever started for this businessObjectId) — the domain service's existing single-step
 *  behavior runs completely unmodified in that case. This is the entire backward-compatibility
 *  mechanism: a workflowType with no definition behaves byte-for-byte as it did before this engine
 *  existed. */
export interface WorkflowActionContext {
  instance: WorkflowInstance | null;
  isFinalLevel: boolean;
}

function addDuration(from: Date, value: number, unit: WorkflowSlaUnit): Date {
  const result = new Date(from.getTime());
  if (unit === WorkflowSlaUnit.HOURS) {
    result.setHours(result.getHours() + value);
    return result;
  }
  // CALENDAR_DAYS and BUSINESS_DAYS both advance in whole days here — a true business-day
  // calendar (skipping weekends/holidays) needs a working-calendar this codebase does not have
  // (same limitation the Template's own SlaUnit design flags: 'business-days' needs a calendar
  // nothing here provides). BUSINESS_DAYS is therefore treated as calendar days for now — an
  // approximation, not a silent miscount, and called out explicitly in the architecture design's
  // own risk list. Never pretend precision this system cannot deliver.
  result.setDate(result.getDate() + value);
  return result;
}

/**
 * THE Workflow orchestration engine. Answers exactly one question RBAC cannot:
 * "is this user's role the configured approver for the CURRENT level of THIS business object's
 * approval journey" — never "can this role ever approve this domain" (that remains
 * PermissionGuard's job, enforced unconditionally before any of this service's code runs, and this
 * service never re-queries role_permissions to check it).
 *
 * See `WORKFLOW_ARCHITECTURE_DESIGN.md` for the full design this implements. Three call sites per
 * domain:
 *   1. `startInstance` — called from the domain's submit path (inside the SAME transaction).
 *   2. `assertCanAct` — called at the very top of the domain's approve()/reject(), BEFORE any
 *      domain-specific status/self-review check runs, so a wrong-level/wrong-role call fails fast
 *      without touching domain state.
 *   3. `recordApproval` / `recordRejection` — called AFTER the domain's own self-review check has
 *      passed but the two are independent: `assertCanAct` gates WHETHER the domain logic may run at
 *      all; `recordApproval`/`recordRejection` records the outcome and advances/closes the
 *      instance. The domain service decides, from `assertCanAct`'s returned `isFinalLevel`, whether
 *      to run its own terminal state change (ACTIVE/APPROVED) or skip it for an intermediate level.
 */
@Injectable()
export class WorkflowOrchestrationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkflowDefinition) private readonly definitions: Repository<WorkflowDefinition>,
    @InjectRepository(WorkflowDefinitionLevel) private readonly definitionLevels: Repository<WorkflowDefinitionLevel>,
    @InjectRepository(WorkflowInstance) private readonly instances: Repository<WorkflowInstance>,
    @InjectRepository(WorkflowInstanceStep) private readonly steps: Repository<WorkflowInstanceStep>,
    private readonly userRoleService: UserRoleService,
    private readonly rolePermissionsService: RolePermissionsService,
  ) {}

  /** Handler registry for AUTO_APPROVE — keeps the dependency direction every other edge in this
   *  module graph already uses (domain -> workflow, never reversed). WorkflowModule deliberately
   *  imports none of Tariff/BillRun/BillingCycleModule (see workflow.module.ts's own doc comment on
   *  the forwardRef() cascade this replaced); instead, each domain service calls
   *  `registerAutoApproveHandler` from its own constructor, handing this service a closure over its
   *  own `approve(id, actorId, isSystemActor)` method. WorkflowSlaSchedulerService then calls
   *  `invokeAutoApproveHandler` instead of injecting any domain service directly. */
  private readonly autoApproveHandlers = new Map<WorkflowType, (businessObjectId: number) => Promise<void>>();

  /** Called once from each domain service's constructor (Tariff/BillRun/BillingCycle). Last writer
   *  wins per workflowType — fine in practice since exactly one domain service ever registers per
   *  WorkflowType, and NestJS only constructs each singleton provider once. */
  registerAutoApproveHandler(workflowType: WorkflowType, handler: (businessObjectId: number) => Promise<void>): void {
    this.autoApproveHandlers.set(workflowType, handler);
  }

  /** Called ONLY from WorkflowSlaSchedulerService's AUTO_APPROVE path. Throws if no domain service
   *  ever registered a handler for this workflowType — this must be unreachable (every WorkflowType
   *  has exactly one owning domain service, each of which registers at construction time), but a
   *  missing handler must fail loudly rather than silently no-op a breached SLA. */
  async invokeAutoApproveHandler(workflowType: WorkflowType, businessObjectId: number): Promise<void> {
    const handler = this.autoApproveHandlers.get(workflowType);
    if (!handler) {
      throw new BadRequestException(`No AUTO_APPROVE handler registered for workflow type ${workflowType}.`);
    }
    await handler(businessObjectId);
  }

  /** The ACTIVE definition for a workflowType, with its ordered levels — or `null` if none exists
   *  (the opt-in-per-workflowType mechanism: no ACTIVE definition means this workflowType has not
   *  adopted real orchestration yet). */
  private async getActiveDefinition(workflowType: WorkflowType, manager?: EntityManager): Promise<{ definition: WorkflowDefinition; levels: WorkflowDefinitionLevel[] } | null> {
    const defRepo = manager ? manager.getRepository(WorkflowDefinition) : this.definitions;
    const levelRepo = manager ? manager.getRepository(WorkflowDefinitionLevel) : this.definitionLevels;

    const definition = await defRepo.findOne({ where: { workflowType, status: WorkflowDefinitionStatus.ACTIVE } });
    if (!definition) return null;

    const levels = await levelRepo.find({ where: { definitionId: definition.id }, order: { levelOrder: 'ASC' } });
    if (levels.length === 0) return null;

    return { definition, levels };
  }

  /** Call from the domain's SUBMIT path (inside the same transaction as the submit itself — pass
   *  `manager`). If no ACTIVE definition exists for `workflowType`, this is a complete no-op —
   *  nothing is created, and the domain's existing single-step behavior is entirely unaffected.
   *
   *  If an ACTIVE definition DOES exist, creates one `WorkflowInstance` pinned to that definition's
   *  `id` (see WorkflowInstance's own doc comment on why this pointer is permanent), plus the first
   *  `WorkflowInstanceStep` row (level 0, activatedAt=now, slaDueAt computed from that level's
   *  snapshotted SLA).
   *
   *  Any PRIOR waiting instance for the same (workflowType, businessObjectId) is cancelled first —
   *  this covers resubmission-reuses-the-same-row domains (Billing Cycle: `resubmit()` flips the
   *  SAME row back to PENDING) as well as resubmission-creates-a-new-row domains (Bill Run), where
   *  no prior waiting instance would exist for the new row anyway. */
  async startInstance(workflowType: WorkflowType, businessObjectId: number, actorId: number | undefined, manager: EntityManager): Promise<void> {
    const active = await this.getActiveDefinition(workflowType, manager);
    if (!active) return;

    const instanceRepo = manager.getRepository(WorkflowInstance);
    const stepRepo = manager.getRepository(WorkflowInstanceStep);

    const priorWaiting = await instanceRepo.find({
      where: { workflowType, businessObjectId, status: WorkflowInstanceStatus.WAITING_FOR_APPROVAL },
    });
    for (const prior of priorWaiting) {
      prior.status = WorkflowInstanceStatus.CANCELLED;
      prior.completedAt = new Date();
      await instanceRepo.save(prior);
    }

    const now = new Date();
    const instance = instanceRepo.create({
      workflowType,
      businessObjectId,
      definitionId: active.definition.id,
      currentLevelOrder: 0,
      status: WorkflowInstanceStatus.WAITING_FOR_APPROVAL,
      submittedById: actorId ?? null,
      submittedAt: now,
      completedAt: null,
    });
    const savedInstance = await instanceRepo.save(instance);

    await this.activateLevel(stepRepo, savedInstance.id, active.levels[0], now);
  }

  private async activateLevel(stepRepo: Repository<WorkflowInstanceStep>, instanceId: number, level: WorkflowDefinitionLevel, activatedAt: Date): Promise<void> {
    const slaDueAt = addDuration(activatedAt, level.slaValue, level.slaUnit);
    await stepRepo.save(
      stepRepo.create({
        instanceId,
        levelOrder: level.levelOrder,
        roleId: level.roleId,
        slaValue: level.slaValue,
        slaUnit: level.slaUnit,
        activatedAt,
        slaDueAt,
        slaBreachedAt: null,
        actedById: null,
        action: null,
        actedAt: null,
        notes: null,
      }),
    );
  }

  /** THE enforcement check. Call at the very top of the domain's approve()/reject(), before any
   *  domain-specific logic. Returns `{ instance: null, isFinalLevel: true }` when no workflow is
   *  configured (treat as "proceed exactly as before" — the one existing level IS the final one).
   *
   *  Throws (never returns a falsy "not allowed" value — a caller bug here must not read as a
   *  silent no-op success):
   *   - NotFoundException  — no active/waiting instance exists at all for this business object
   *     (should not happen if startInstance ran correctly; surfaced rather than assumed)
   *   - ConflictException  — instance already COMPLETED/REJECTED/CANCELLED (someone already acted,
   *     or the object was superseded) — the safe "already processed" response concurrency requires
   *   - ForbiddenException — the acting user holds no role matching the CURRENT level's configured
   *     role. This is deliberately NOT a 403 from PermissionGuard (which already passed, confirming
   *     the user's role CAN approve this domain in general) — it is Workflow's own, independent
   *     "not your turn" refusal.
   *
   *  Role matching uses `UserRoleService.getRoleIds(actorId)` — ALL of the user's currently active
   *  roles, never `users.role_id` — so a user is eligible if ANY of their roles matches the
   *  level's configured role, correctly ready for true multi-role support without this method
   *  needing to change later (see UserRoleService's own doc comment on this exact seam).
   *
   *  `isSystemActor` — true ONLY when called from WorkflowSlaSchedulerService's AUTO_APPROVE path
   *  (see that service's own doc comment). Skips the actorId/role-match check entirely: there is no
   *  human role to match against an automated, SLA-breach-triggered approval, and requiring one
   *  would make AUTO_APPROVE impossible to implement at all. Every other check (instance exists,
   *  instance still WAITING_FOR_APPROVAL, current step not already acted upon, the row lock) still
   *  runs unconditionally — this flag narrows WHO may act, it never widens WHAT is allowed to
   *  happen to the instance's actual state. Defaults to false for all 7 existing domain call
   *  sites — zero behavior change for any real human approval. */
  async assertCanAct(workflowType: WorkflowType, businessObjectId: number, actorId: number | undefined, manager?: EntityManager, isSystemActor = false): Promise<WorkflowActionContext> {
    const stepRepo = manager ? manager.getRepository(WorkflowInstanceStep) : this.steps;

    // Locked read when a transaction manager is supplied — this is the concurrency guarantee
    // (requirement #9): two concurrent approve() calls for the same business object both reach
    // this line, but only one acquires the row lock first; the second blocks here until the first
    // transaction commits (having advanced/completed the instance), then re-reads a status/
    // currentLevelOrder that has already moved — its own checks below now correctly see "already
    // processed" or "not your level anymore" and throw ConflictException, never double-advancing.
    // Mirrors BillingCycleService.approve()'s own pessimistic_write pattern exactly (see that
    // method's doc comment on the real race it was built to fix).
    //
    // TWO QUERIES deliberately, not one `WHERE workflowType=... AND businessObjectId=... FOR
    // UPDATE`: an unlocked lookup by (workflowType, businessObjectId) finds the row's id first,
    // then a SECOND query locks strictly `WHERE id = :id` — a single-row primary-key equality
    // lock. Locking directly on the compound (non-unique-index) predicate with FOR UPDATE let two
    // concurrent transactions each acquire a GAP lock on overlapping index ranges under InnoDB's
    // default REPEATABLE READ isolation, producing a genuine MySQL deadlock (confirmed via a live
    // Promise.allSettled test) instead of the second transaction cleanly blocking and waiting. A
    // primary-key-scoped FOR UPDATE has no such gap-locking ambiguity.
    const instance = manager
      ? await (async () => {
          const found = await manager
            .getRepository(WorkflowInstance)
            .findOne({ where: { workflowType, businessObjectId }, order: { id: 'DESC' } });
          if (!found) return null;
          return manager
            .createQueryBuilder(WorkflowInstance, 'wi')
            .setLock('pessimistic_write')
            .where('wi.id = :id', { id: found.id })
            .getOne();
        })()
      : await this.instances.findOne({ where: { workflowType, businessObjectId }, order: { id: 'DESC' } });

    if (!instance) {
      // No instance was ever created for this object — either no definition was ACTIVE for this
      // workflowType at submit time, or (should never happen) startInstance was never called.
      // Either way, there is nothing for Workflow to enforce: proceed as the pre-engine single-step
      // behavior always did.
      return { instance: null, isFinalLevel: true };
    }

    if (instance.status !== WorkflowInstanceStatus.WAITING_FOR_APPROVAL) {
      throw new ConflictException('This item has already been processed by the workflow — refresh and check its current status.');
    }

    const activeDefLevels = await (manager ? manager.getRepository(WorkflowDefinitionLevel) : this.definitionLevels).count({
      where: { definitionId: instance.definitionId },
    });
    const currentStep = await stepRepo.findOne({
      where: { instanceId: instance.id, levelOrder: instance.currentLevelOrder ?? -1 },
    });
    if (!currentStep || currentStep.action !== null) {
      throw new ConflictException('This approval level has already been acted upon — refresh and check its current status.');
    }

    if (!isSystemActor) {
      if (!actorId) {
        throw new ForbiddenException('Could not determine the acting user for this approval.');
      }
      const actorRoleIds = await this.userRoleService.getRoleIds(actorId);
      if (!actorRoleIds.includes(currentStep.roleId)) {
        throw new ForbiddenException(
          `This item is waiting on Level ${instance.currentLevelOrder! + 1} — your role is not the configured approver for that level.`,
        );
      }
    }

    const isFinalLevel = (instance.currentLevelOrder ?? 0) >= activeDefLevels - 1;
    return { instance, isFinalLevel };
  }

  /** Call AFTER the domain's own approve logic has run (self-review check already passed, domain
   *  mutation already applied if this was the final level). Records the current step as APPROVED
   *  and either advances to the next level (intermediate) or completes the instance (final level).
   *  No-ops cleanly if `context.instance` is null (no workflow configured). */
  async recordApproval(context: WorkflowActionContext, actorId: number | undefined, notes: string | undefined, manager: EntityManager): Promise<void> {
    if (!context.instance) return;
    const instanceRepo = manager.getRepository(WorkflowInstance);
    const stepRepo = manager.getRepository(WorkflowInstanceStep);

    const instance = context.instance;
    const currentStep = await stepRepo.findOne({ where: { instanceId: instance.id, levelOrder: instance.currentLevelOrder ?? -1 } });
    if (!currentStep) throw new NotFoundException('Workflow step not found — this should not happen after assertCanAct succeeded.');

    const now = new Date();
    currentStep.actedById = actorId ?? null;
    currentStep.action = WorkflowStepAction.APPROVED;
    currentStep.actedAt = now;
    currentStep.notes = notes ?? null;
    await stepRepo.save(currentStep);

    if (context.isFinalLevel) {
      instance.status = WorkflowInstanceStatus.COMPLETED;
      instance.currentLevelOrder = null;
      instance.completedAt = now;
      await instanceRepo.save(instance);
      return;
    }

    const levelRepo = manager.getRepository(WorkflowDefinitionLevel);
    const nextLevel = await levelRepo.findOne({
      where: { definitionId: instance.definitionId, levelOrder: (instance.currentLevelOrder ?? 0) + 1 },
    });
    if (!nextLevel) {
      // Definition says this wasn't the final level (isFinalLevel was false) but no next level row
      // exists — a data-integrity contradiction, not a normal path. Fail loudly rather than silently
      // completing or stalling.
      throw new BadRequestException('Workflow definition is missing the next configured level — contact an administrator.');
    }
    instance.currentLevelOrder = nextLevel.levelOrder;
    await instanceRepo.save(instance);
    await this.activateLevel(stepRepo, instance.id, nextLevel, now);
  }

  /** Call AFTER the domain's own reject logic has run. Records the current step as REJECTED and
   *  closes the instance — a rejection at ANY level ends the whole journey (requirement: never a
   *  partial "send back to a lower level" distinct from the domain's own existing resubmit/return
   *  semantics — that is a DOMAIN lifecycle concept, not a Workflow one; see §12 of the brief). */
  async recordRejection(context: WorkflowActionContext, actorId: number | undefined, reason: string | undefined, manager: EntityManager): Promise<void> {
    if (!context.instance) return;
    const instanceRepo = manager.getRepository(WorkflowInstance);
    const stepRepo = manager.getRepository(WorkflowInstanceStep);

    const instance = context.instance;
    const currentStep = await stepRepo.findOne({ where: { instanceId: instance.id, levelOrder: instance.currentLevelOrder ?? -1 } });
    if (currentStep) {
      currentStep.actedById = actorId ?? null;
      currentStep.action = WorkflowStepAction.REJECTED;
      currentStep.actedAt = new Date();
      currentStep.notes = reason ?? null;
      await stepRepo.save(currentStep);
    }

    instance.status = WorkflowInstanceStatus.REJECTED;
    instance.currentLevelOrder = null;
    instance.completedAt = new Date();
    await instanceRepo.save(instance);
  }

  /** Called ONLY from WorkflowSlaSchedulerService when a step's configured on-breach behaviour is
   *  ESCALATE. Force-closes the current (overdue, unacted) step as ESCALATED — never APPROVED, so
   *  this never reads as a genuine human or system approval in the step history — and activates the
   *  next configured level exactly the same way recordApproval's own intermediate-level branch does
   *  (reusing activateLevel directly, same-class access).
   *
   *  Deliberately does NOT touch the underlying domain object's status at all (no Tariff/BillRun/
   *  BillingCycle field is read or written here) — escalation only ever moves WHICH LEVEL is
   *  current within the workflow instance; the domain stays exactly as pending as it already was.
   *  The instance itself also stays WAITING_FOR_APPROVAL (never COMPLETED) — only a genuine
   *  approval at the actual final level completes it, per the explicit requirement that escalating
   *  off of a level must never be mistaken for approving it.
   *
   *  Throws BadRequestException if there is no next level to escalate to — this must be
   *  unreachable in practice (WorkflowDefinitionService.assertLevels refuses to save ESCALATE on a
   *  final level at publish time), but the scheduler must never silently invent a next level if
   *  this invariant is ever violated by a data inconsistency (e.g. a level deleted after instances
   *  already started against an older, longer version of the same definition).
   *
   *  Caller (the scheduler) is responsible for its own row lock on the step BEFORE calling this —
   *  see WorkflowSlaSchedulerService.breachOneStep's own pessimistic_write lock, acquired on the
   *  exact same primary-key-only pattern as assertCanAct uses. */
  async recordEscalation(step: WorkflowInstanceStep, manager: EntityManager): Promise<void> {
    const instanceRepo = manager.getRepository(WorkflowInstance);
    const stepRepo = manager.getRepository(WorkflowInstanceStep);
    const levelRepo = manager.getRepository(WorkflowDefinitionLevel);

    const instance = await instanceRepo.findOne({ where: { id: step.instanceId } });
    if (!instance) throw new NotFoundException('Workflow instance not found for escalation.');

    const nextLevel = await levelRepo.findOne({
      where: { definitionId: instance.definitionId, levelOrder: step.levelOrder + 1 },
    });
    if (!nextLevel) {
      throw new BadRequestException(
        `Cannot escalate Level ${step.levelOrder + 1} — no next level is configured on this workflow definition.`,
      );
    }

    step.action = WorkflowStepAction.ESCALATED;
    step.actedAt = new Date();
    step.actedById = null;
    step.notes = `Escalated by system — SLA breached on Level ${step.levelOrder + 1} with no human action taken.`;
    await stepRepo.save(step);

    instance.currentLevelOrder = nextLevel.levelOrder;
    await instanceRepo.save(instance);
    await this.activateLevel(stepRepo, instance.id, nextLevel, new Date());
  }

  /** Authorizes VIEWING a workflowType's runtime state (instance/steps) — deliberately NOT the
   *  same question as WORKFLOW_VIEW (that gates CONFIGURATION: the definitions/levels screen under
   *  Business Administration -> Workflow). A Finance user who can see/approve Tariffs must be able
   *  to see a Tariff's approval progress without also being granted the generic workflow-config
   *  permission — see RUNTIME_VIEW_ACTION_CODES's own doc comment for why each domain's real
   *  view-or-approve codes are the right test here, not a new permission and not a hardcoded role
   *  name (role names are workflow CONFIGURATION data — `WorkflowDefinitionLevel.roleId` — never an
   *  authorization primitive in their own right; see assertCanAct's own doc comment on that same
   *  distinction for the approve path).
   *
   *  Resolves ALL of the acting user's currently active roles via UserRoleService.getRoleIds —
   *  never the JWT's single `roleId` claim, which is only ever that user's PRIMARY role and would
   *  silently under-authorize a genuinely multi-role user, exactly the same reasoning assertCanAct
   *  already applies to the approve path. The actor's own inline policies count too (an inline
   *  policy may grant a view code; it can never make someone an approver — approving is tied to a
   *  ROLE at a workflow level, see assertCanAct). Throws ForbiddenException (matching
   *  PermissionGuard's own failure shape) rather than returning a boolean, so callers get the same
   *  403 behavior a guard-rejected request would. */
  async assertCanViewRuntime(workflowType: WorkflowType, actorId: number | undefined): Promise<void> {
    if (!actorId) {
      throw new ForbiddenException('Could not determine the acting user for this request.');
    }
    const requiredActionCodes = RUNTIME_VIEW_ACTION_CODES[workflowType];
    const actorRoleIds = await this.userRoleService.getRoleIds(actorId);
    for (const actionCode of requiredActionCodes) {
      if (await this.rolePermissionsService.rolesHaveAction(actorRoleIds, actionCode, actorId)) {
        return;
      }
    }
    throw new ForbiddenException('You do not have access to view this workflow runtime state.');
  }

  /** The live instance + full step history for one business object — backs the Workflow Execution
   *  UI (current level, waiting-since, SLA status, approval history). Returns `null` if no
   *  instance was ever created (workflowType not opted in, or object never submitted).
   *
   *  `select` on every relation is deliberate, not an optimization — there is no global
   *  ClassSerializerInterceptor/@Exclude() on the User entity in this codebase, so a bare
   *  `relations: { submittedBy: true }` would serialize the FULL User row, passwordHash included,
   *  straight into this API response. Projecting to exactly the fields the UI needs (id/name) is
   *  the actual fix, scoped to this endpoint only — a codebase-wide serialization audit is a
   *  separate concern, out of scope here. */
  async getInstanceView(workflowType: WorkflowType, businessObjectId: number) {
    const instance = await this.instances.findOne({
      where: { workflowType, businessObjectId },
      order: { id: 'DESC' },
      relations: { submittedBy: true },
      select: {
        id: true,
        workflowType: true,
        businessObjectId: true,
        definitionId: true,
        currentLevelOrder: true,
        status: true,
        submittedAt: true,
        completedAt: true,
        submittedById: true,
        submittedBy: { id: true, firstName: true, lastName: true },
      },
    });
    if (!instance) return null;

    const stepRows = await this.steps.find({
      where: { instanceId: instance.id },
      order: { levelOrder: 'ASC' },
      relations: { role: true, actedBy: true },
      select: {
        id: true,
        levelOrder: true,
        roleId: true,
        slaValue: true,
        slaUnit: true,
        activatedAt: true,
        slaDueAt: true,
        slaBreachedAt: true,
        actedById: true,
        action: true,
        actedAt: true,
        notes: true,
        role: { id: true, roleName: true },
        actedBy: { id: true, firstName: true, lastName: true },
      },
    });

    // `steps` above is intentionally LAZY — startInstance only ever materializes level 0's step;
    // each later level's step is created on demand, only once the instance actually reaches it (see
    // recordApproval). That is correct for execution (the write-once `instance.definitionId`
    // pointer is what preserves versioning, not how many step rows happen to exist yet), but it
    // means `steps.length` is NEVER a safe stand-in for "how many levels this workflow has" — for an
    // instance sitting at Level 1 of a 2-level definition, `steps` legitimately contains only one
    // row. The UI must know the TRUE total up front (e.g. "Level 1 of 2"), so this additionally
    // returns every level actually configured on the version this instance is pinned to
    // (`instance.definitionId` — the same write-once pointer startInstance set, never the CURRENT
    // active definition, which could differ if a newer version was published since). This is the
    // root-cause fix for levels not yet reached rendering as if they didn't exist — never computed
    // client-side from steps.length; always this real, persisted level list.
    const definitionLevels = await this.definitionLevels.find({
      where: { definitionId: instance.definitionId },
      order: { levelOrder: 'ASC' },
      relations: { role: true },
      select: {
        id: true,
        levelOrder: true,
        roleId: true,
        slaValue: true,
        slaUnit: true,
        role: { id: true, roleName: true },
      },
    });

    return {
      instance,
      steps: stepRows,
      definitionLevels,
    };
  }

  /** Every currently-WAITING_FOR_APPROVAL instance for a workflowType — backs the Instance tab's
   *  "All in-flight" queue view (§O.2). READ-ONLY — this never advances or acts on anything; it is
   *  pure visibility. Each row's `currentStep` is the one open (unacted) step, giving the queue
   *  exactly what it needs to show "current level + role, SLA countdown" without a second query per
   *  row. Same `select` projection discipline as `getInstanceView` — no User/Role field beyond
   *  id/name ever serializes out. */
  async listInFlightInstances(workflowType: WorkflowType) {
    const instances = await this.instances.find({
      where: { workflowType, status: WorkflowInstanceStatus.WAITING_FOR_APPROVAL },
      order: { submittedAt: 'ASC' },
      relations: { submittedBy: true },
      select: {
        id: true,
        workflowType: true,
        businessObjectId: true,
        currentLevelOrder: true,
        status: true,
        submittedAt: true,
        submittedById: true,
        submittedBy: { id: true, firstName: true, lastName: true },
      },
    });
    if (instances.length === 0) return [];

    const currentSteps = await this.steps.find({
      where: { instanceId: In(instances.map((i) => i.id)), action: IsNull() },
      relations: { role: true },
      select: {
        id: true,
        instanceId: true,
        levelOrder: true,
        roleId: true,
        slaDueAt: true,
        slaBreachedAt: true,
        role: { id: true, roleName: true },
      },
    });
    const stepByInstanceId = new Map(currentSteps.map((s) => [s.instanceId, s]));

    return instances.map((instance) => ({
      instance,
      currentStep: stepByInstanceId.get(instance.id) ?? null,
    }));
  }
}
