# Workflow Orchestration Engine — Architecture Design

**Status: DESIGN FOR REVIEW. No code, migrations, permissions, or behavior have been changed.**

---

## A. Current Architecture Findings

### A.1 What exists today

| Concept | Where | Shape |
|---|---|---|
| Tariff approval | `TariffService.approve()`/`reject()` (`tariff.service.ts:603-636`) | Single status flip (`PENDING → ACTIVE`/`REJECTED`), plain `repository.save()`, **no transaction wrapper**, no lock |
| Bill Run approval | `BillRunService.approve()`/`reject()` (`bill-run.service.ts:312-361`) | Single status flip (`PENDING_APPROVAL → APPROVED`/`REJECTED`), plain `repository.save()`, **no transaction wrapper**, triggers bill generation as a best-effort side effect after save |
| Billing Cycle approval | `BillingCycleService.approve()`/`reject()` (`billing-cycle.service.ts:480-535`) | Single status flip, **wrapped in `dataSource.transaction()` with `pessimistic_write` row lock** — the newest of the three, built after a real concurrency bug was found |
| Self-approval guard | `assertNotSelfReview()` (`common/utils/versioning.util.ts:15-25`) | Shared utility, called by all three domains — genuinely enforced, throws before mutation |
| RBAC | `role_permissions` + `PermissionGuard` (`permission.guard.ts`) | Action-code based, OR-semantics across multiple codes per route, enforced server-side independent of UI |
| `workflow_approval_levels` | `WorkflowService.getApprovalPolicy/updateApprovalPolicy` | **Advisory only** — zero code references from any domain service. This is the gap this design closes. |
| Audit trail | `AuditLog` entity + `AuditService.record()` (`audit/`) | One generic polymorphic table (`moduleName` + `entityId` discriminator), no `level`/`workflowInstanceId` column, no dedicated "current state" query — a historical log, not a state store |
| Scheduler | `@nestjs/schedule`, two `@Cron(EVERY_DAY_AT_MIDNIGHT)` jobs (Tariff, Billing Cycle) | Pattern: cron → `createQueryBuilder` date comparison → flip status → `auditService.record()`. No generic "SLA clock" exists. |
| Events | `@nestjs/event-emitter`, exactly one producer/listener pair (`registration-request` → `customer-activation.listener.ts`) | Proven pattern: commit transaction → emit → async listener → best-effort email, never rolls back the triggering transaction |
| Mail | `MailService` (`mail/mail.service.ts`) | Thin SMTP wrapper, never throws, no retry/queue |
| Queue | **CONFIRMED ABSENT** | No Bull/BullMQ/RabbitMQ/SQS/Kafka in `package.json`. `ioredis` present but unwired to any queue. |
| State machine | **CONFIRMED ABSENT** | Every transition is an ad-hoc `if (status !== X) throw`, duplicated per domain, no shared transition table |
| Optimistic locking | **CONFIRMED ABSENT** | No `@VersionColumn` anywhere. Only pessimistic row locks (`pessimistic_write`), and only in Billing Cycle + two Bill Run call sites |

### A.2 The core gap

Nothing in `TariffService`, `BillRunService`, or `BillingCycleService` reads `workflow_approval_levels`. A user holding `TARIFF_APPROVE` can approve a pending Tariff regardless of what the policy table says — confirmed by full-body reads of all three `approve()` methods in the prior audit. This is the one fact this entire design exists to change.

---

## B. What Can Be Reused

- **RBAC stack, unchanged.** `PermissionGuard`, `@Permission(...)`, `role_permissions`, all existing action codes (`TARIFF_APPROVAL_APPROVE`, `BILL_RUN_APPROVE`, `BILLING_CYCLE_APPROVAL_APPROVE`, etc.). Workflow never replaces this — it adds a second, independent check that must *also* pass.
- **`assertNotSelfReview`.** Reused as-is by every domain; Workflow does not reimplement self-approval logic.
- **`AuditLog`/`AuditService.record()`.** Reused for the generic "who did what, when" trail on the domain object itself (e.g., `TARIFF_APPROVE` action row) — Workflow adds its own dedicated history table (see §D) for level-by-level execution state, rather than overloading `audit_logs` with columns it was never designed to hold.
- **`@nestjs/schedule` + the existing cron pattern.** SLA-breach detection reuses the exact `@Cron` → `createQueryBuilder` → flip-state → `auditService.record()` shape already proven in `TariffSchedulerService`/`BillingCycleSchedulerService`.
- **`@nestjs/event-emitter` + the proven commit-then-emit pattern.** Reused for SLA-breach / level-advanced notifications, following `registration-request` → `customer-activation.listener.ts` exactly: emit only after the owning transaction commits, async listener, never rethrows.
- **`dataSource.transaction()` + `pessimistic_write`.** Reused as the concurrency primitive for workflow-instance mutations — same tool Billing Cycle already uses for the identical problem (two concurrent approvals of the same row).
- **The Approver-role-picker UI pattern already built** (`CCB_Web/components/workflow/WorkflowList.tsx`'s role dropdown, department/SLA/on-breach selects) — the Workflow **Definition** editor reuses this UI almost unchanged; only the **Instance** view is net-new.

## C. What Is Missing (must be introduced)

1. A **Workflow Definition** concept that is versioned and immutable once an instance references it (today's `workflow_approval_levels` is a single live row-set with no version column — editing it today retroactively changes "the policy," which is fine for an advisory display but unsafe once instances pin to a version).
2. A **Workflow Instance** entity + its own level-execution-history table (does not exist in any form).
3. A single, reusable **"assert this actor may act on this instance at its current level"** check that `TariffService.approve()`, `BillRunService.approve()`, and `BillingCycleService.approve()` all call before doing anything else.
4. A **SLA clock** — nothing currently measures elapsed time against a duration; only date-field-vs-today comparisons exist.
5. **Idempotency/locking for workflow-instance transitions** — reuse the Billing Cycle `pessimistic_write` pattern, applied to the new instance table.
6. Optional, infrastructure-dependent: breach notifications via the existing `MailService`/`EventEmitter2` — explicitly flagged as buildable-now-but-best-effort, not a blocking dependency.

---

## D. Proposed Database Model

Three new tables. Nothing existing is altered in this design (no columns added to `tariff_versions`, `bill_runs`, or `billing_cycle_versions` — see §P for why, and the one narrow exception).

### D.1 `workflow_definitions` (replaces today's "live" `workflow_approval_levels` as the versioned header)

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `workflowType` | varchar(20) | `TARIFF` \| `BILL_RUN` \| `BILLING_CYCLE` |
| `version` | int | 1, 2, 3... per `workflowType`, monotonically increasing |
| `status` | varchar(10) | `DRAFT` \| `ACTIVE` \| `ARCHIVED` — exactly one `ACTIVE` row per `workflowType` at a time |
| `createdBy` | int, FK → users | |
| `createdAt`/`updatedAt`/`deletedAt` | — | `BaseEntity` |

### D.2 `workflow_definition_levels` (replaces today's `workflow_approval_levels` rows, now scoped to a definition version instead of a bare workflowType)

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `definitionId` | FK → `workflow_definitions.id`, CASCADE | |
| `levelOrder` | int | 0-based, same convention as today |
| `roleId` | FK → `roles.id`, CASCADE | **Same meaning as today: "which role is responsible," not an RBAC grant** |
| `department` | varchar(30), nullable | unchanged from today |
| `slaValue` | int | unchanged |
| `slaUnit` | varchar(20) | unchanged |
| `onBreach` | varchar(20) | unchanged |
| `createdAt`/`updatedAt`/`deletedAt` | — | `BaseEntity` |

This is structurally identical to today's `workflow_approval_levels` — the only change is the extra indirection through `definitionId` instead of being keyed directly by `workflowType`, which is what makes versioning possible (§M).

### D.3 `workflow_instances` (new — one row per real Tariff/Bill Run/Billing Cycle submission that enters approval)

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `workflowType` | varchar(20) | denormalized for query convenience |
| `businessObjectId` | int | the `TariffVersion.id` / `BillRun.id` / `BillingCycleVersion.id` |
| `definitionId` | FK → `workflow_definitions.id` | **pinned at creation — never follows later definition edits (§M)** |
| `currentLevelOrder` | int, nullable | null once `COMPLETED`/`REJECTED`/`CANCELLED` |
| `status` | varchar(20) | `WAITING_FOR_APPROVAL` \| `COMPLETED` \| `REJECTED` \| `CANCELLED` |
| `submittedBy` | FK → users | |
| `submittedAt` | datetime | |
| `completedAt` | datetime, nullable | |
| `createdAt`/`updatedAt`/`deletedAt` | — | `BaseEntity` |

Unique index on `(workflowType, businessObjectId)` **where `status = 'WAITING_FOR_APPROVAL'`** (a partial/filtered unique index, or enforced at the application layer inside the creating transaction) — at most one *active* instance per business object at a time, while still allowing historical completed/rejected rows for the same object across resubmissions.

### D.4 `workflow_instance_steps` (new — the execution/history ledger; answers every question in §9 of the brief)

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `instanceId` | FK → `workflow_instances.id`, CASCADE | |
| `levelOrder` | int | which level this row is about |
| `roleId` | FK → `roles.id` | the role configured for this level **at the time the instance was created** (copied from `workflow_definition_levels`, not a live join — so a later role rename/deletion doesn't rewrite history) |
| `slaDueAt` | datetime, nullable | computed when the level becomes active: `activatedAt + slaValue(slaUnit)` |
| `activatedAt` | datetime | when this level became "current" |
| `actedBy` | FK → users, nullable | who actually acted (null until acted) |
| `action` | varchar(20), nullable | `APPROVED` \| `REJECTED` \| `RETURNED` \| `SLA_BREACHED` \| `ESCALATED` |
| `actedAt` | datetime, nullable | |
| `notes` | text, nullable | |

One row is inserted the moment a level becomes current; it is updated (not replaced) when acted upon, and a fresh row is inserted for the next level. This single table answers: created-when, submitted-by-whom, which level was active, who acted, what action, when, previous/next level (derivable from `levelOrder` ordering within `instanceId`), rejected/returned (via `action`), SLA breached (via `action = 'SLA_BREACHED'` row or a boolean/flag — see §K), completion time (`workflow_instances.completedAt`).

### D.5 The one existing-table touch point (narrow, explicit)

None, in this design. `TariffVersion`/`BillRun`/`BillingCycleVersion` gain **no new column**. The link from a workflow instance back to its business object is `workflow_instances.businessObjectId` + `workflowType`, looked up from the Workflow side — domain entities stay exactly as they are. This is deliberate: it means Workflow can be introduced, and even removed, without an irreversible schema change to the three domain tables.

---

## E. Proposed API Model

### E.1 Definition management (replaces today's `GET/PUT /workflow/approval-policy/:workflowType`)

| Route | Permission | Behavior |
|---|---|---|
| `GET /workflow/definitions/:workflowType` | `WORKFLOW_VIEW` | Returns the current `ACTIVE` definition + its levels (same shape as today's `getApprovalPolicy`, plus `version`/`status`) |
| `GET /workflow/definitions/:workflowType/history` | `WORKFLOW_VIEW` | Lists all versions (ACTIVE/ARCHIVED/DRAFT) for audit/comparison |
| `PUT /workflow/definitions/:workflowType` | `WORKFLOW_MANAGE_APPROVERS` (unchanged — no new RBAC code, per constraint #14) | Creates a **new version** (never mutates the active one in place — see §M), archives the previous ACTIVE version, same validation as today's `assertLevels` (role existence, enum/positive-integer checks, duplicate-level detection) |

### E.2 Instance visibility (new)

| Route | Permission | Behavior |
|---|---|---|
| `GET /workflow/instances/:workflowType/:businessObjectId` | `WORKFLOW_VIEW` | Current instance for one business object: status, current level, current-level eligible role, SLA due/remaining, full step history |
| `GET /workflow/instances?workflowType=&status=&currentLevelRoleId=` | `WORKFLOW_VIEW` | List view — "what's waiting on me," filterable by the caller's own role for a personal queue |

### E.3 No new mutation routes on `WorkflowController`

Per constraint #14 and the brief's explicit instruction not to create a second approval system: **there is no `POST /workflow/instances/:id/approve`.** The existing routes remain the only way to approve/reject:

- `PATCH /tariff/:id/approve` / `/reject`
- `PATCH /bill-runs/:id/approve` / `/reject`
- `PATCH /billing-cycle/:id/approve` / `/reject`

Each of these, internally, now calls into a shared Workflow check before doing its existing work (§F, §J). The HTTP contract for callers (CCB_Web) **does not change** — same routes, same request/response shapes, same `@Permission(...)` decorators. The only behavioral difference a caller observes is a new possible rejection reason ("not your turn" / "level mismatch") alongside the existing ones ("not pending," "self-review").

---

## F. Workflow State Machine

### F.1 Instance states

```
                 ┌──────────────────────┐
  (created) ───▶ │  WAITING_FOR_APPROVAL │
                 └───────────┬───────────┘
                             │
          ┌──────────────────┼───────────────────┐
          │ level approved,  │ level rejected     │ cancelled
          │ more levels left │ (any level)        │ (business-object
          ▼                  ▼                    │  withdrawn/resubmitted
  stays WAITING_FOR_APPROVAL │                     │  before completion)
  (currentLevelOrder++)      ▼                     ▼
          │            ┌──────────┐        ┌────────────┐
          │            │ REJECTED │        │ CANCELLED  │
          │            └──────────┘        └────────────┘
          │ final level approved
          ▼
   ┌───────────┐
   │ COMPLETED │
   └───────────┘
```

- `WAITING_FOR_APPROVAL` is the only "live" state; `currentLevelOrder` always points at the level awaiting action.
- A rejection at **any** level immediately moves the instance to `REJECTED` — there is no "send back to a lower level" distinct from a domain's own existing `RETURNED_FOR_CORRECTION`/resubmit concept (which is a *domain* lifecycle state, orthogonal to the workflow instance — see §F.3).
- `CANCELLED` exists for the edge case where the underlying business object is withdrawn/deleted/superseded while an instance is still waiting (e.g., a Tariff is edited again before anyone approves level 1 — the old instance is cancelled, a new one is created on resubmit).

### F.2 Level transition rule (the actual enforcement)

```
canAct(instance, actingUser) =
     instance.status == WAITING_FOR_APPROVAL
  AND actingUser.roleId == instance.currentStep.roleId        // Workflow's check: right role for this level
  AND roleHasAction(actingUser.roleId, domainApproveCode)     // RBAC's check: role actually holds the permission
                                                                // (already enforced by PermissionGuard upstream —
                                                                //  Workflow does NOT re-query role_permissions itself,
                                                                //  it trusts the guard already ran; see §J)
```

Both conditions must hold. The second is **not Workflow's job to check** — it already happened, unconditionally, in `PermissionGuard` before the controller method was even entered (per the existing RBAC stack, untouched). Workflow's own responsibility is exactly the first condition: is this the right role for the *current* level. This is the literal implementation of requirement §3 ("Both must pass").

### F.3 Relationship to each domain's own status enum

Workflow's `WAITING_FOR_APPROVAL`/`COMPLETED`/`REJECTED` are a **parallel, generic** state machine — they do not replace `TariffStatus.PENDING`/`ACTIVE`/`REJECTED` or `BillRunStatus.PENDING_APPROVAL`/`APPROVED`/`REJECTED`. A domain object's own status still governs its own lifecycle (activation, effective dates, bill generation, resubmission) exactly as today. The mapping is:

| Domain event | Domain status (unchanged) | Workflow instance action |
|---|---|---|
| Tariff submitted | `PENDING` | Workflow instance **created**, `currentLevelOrder = 0` |
| Intermediate level approved | still `PENDING` (domain status does NOT change) | `currentLevelOrder++`, step row updated |
| Final level approved | domain's existing `approve()` logic runs (`ACTIVE`, `approvalDate` stamped) | Workflow instance → `COMPLETED` |
| Any level rejected | domain's existing `reject()` logic runs (`REJECTED`, `rejectionReason` stamped) | Workflow instance → `REJECTED` |

This is the critical design point that satisfies "do not break existing tariff versioning" / "preserve existing Billing Cycle lifecycle": **the domain's own terminal transition (PENDING→ACTIVE, PENDING_APPROVAL→APPROVED) only happens once, at the Workflow instance's final level — intermediate levels are entirely a Workflow-side concept that the domain status enum never sees.**

---

## G. Tariff Execution Flow

```
TariffService.submit()                         [UNCHANGED — existing validation, status→PENDING]
   │
   └─▶ WorkflowOrchestrationService.startInstance('TARIFF', version.id, actorId)
         │  - loads the ACTIVE workflow_definitions row for TARIFF (if none exists: see "no definition configured" below)
         │  - creates workflow_instances row, currentLevelOrder=0
         │  - creates workflow_instance_steps row for level 0, activatedAt=now, slaDueAt=computed
         │  - all inside the SAME transaction as submit()'s own status flip (one atomic unit)

   ... time passes, Manager (L1) calls PATCH /tariff/:id/approve ...

TariffController.approve (unchanged route/decorator: @Permission('TARIFF_APPROVE','TARIFF_APPROVAL_APPROVE'))
   │  [PermissionGuard already confirmed Manager holds one of these two codes — unchanged]
   ▼
TariffService.approve(id, actorId)
   │
   ├─▶ WorkflowOrchestrationService.assertCanAct('TARIFF', id, actorId)   // NEW — throws 403-equivalent if wrong level/role
   │
   ├─▶ IF this was the FINAL level:
   │      existing approve() logic runs UNCHANGED (status→ACTIVE, approvedBy, approvalDate, audit)
   │      WorkflowOrchestrationService.recordStepAction(..., 'APPROVED')
   │      WorkflowOrchestrationService.completeInstance(...)
   │
   └─▶ IF this was an INTERMEDIATE level:
          domain status stays PENDING — existing approve() terminal logic does NOT run
          WorkflowOrchestrationService.recordStepAction(..., 'APPROVED')
          WorkflowOrchestrationService.advanceToNextLevel(...)  // currentLevelOrder++, new step row, new SLA clock
          return a response indicating "approved at this level, awaiting L{n+1}"
```

**No definition configured for TARIFF** (today's actual live state, per the prior audit — the policy table can be empty): `startInstance` finds no `ACTIVE` `workflow_definitions` row and **falls back to today's exact single-step behavior** — no instance is created at all, and `assertCanAct`/intermediate-level logic is simply skipped (treated as "already at the only/final level"). This is the explicit backward-compatibility path requirement §11 implies and the brief's "do not break existing behavior" demands: **Workflow is opt-in per workflow type, driven entirely by whether an ACTIVE definition exists.**

Rejection at any level: `TariffService.reject()` gains the same `assertCanAct` guard at its top; on success, existing reject logic runs unchanged (status→`REJECTED`), and `WorkflowOrchestrationService.rejectInstance(...)` closes out the instance regardless of which level rejected it.

Resubmission after rejection: `TariffService.submit()`'s existing resubmission path (same method, re-enterable per `SUBMITTABLE_TARIFF_STATUSES`) calls `startInstance` again — a **fresh** instance, pinned to whatever definition version is `ACTIVE` at that moment (could differ from the rejected attempt's version if an admin changed the definition in between — this is intended, not a bug: a resubmission is a new approval journey).

---

## H. Bill Run Execution Flow

Structurally identical to Tariff, with two differences specific to Bill Run's existing design:

```
BillRunService.submitWithinTransaction()        [UNCHANGED — existing pessimistic_write duplicate-check,
                                                   status defaults to PENDING_APPROVAL]
   │
   └─▶ WorkflowOrchestrationService.startInstance('BILL_RUN', billRun.id, actorId)
         (same transaction as submit — Bill Run already wraps submit in a transaction, unlike approve)

   ... Finance (configured L1, or L-final) calls PATCH /bill-runs/:id/approve via Bill Run Register ...

BillRunController.approve (unchanged route/decorator: @Permission('BILL_RUN_APPROVE'))
   ▼
BillRunService.approve(id, dto, actorId)
   │
   ├─▶ WorkflowOrchestrationService.assertCanAct('BILL_RUN', id, actorId)
   │
   ├─▶ IF final level:
   │      existing approve() logic runs UNCHANGED (status→APPROVED, reviewedBy/reviewedOn/reviewNotes)
   │      the existing best-effort generateBillsForBillRun(...) call — UNCHANGED, still outside any
   │        transaction, still swallows its own errors (per the explicit existing design intent) — fires
   │        only once, at true completion, never after an intermediate level
   │      WorkflowOrchestrationService.completeInstance(...)
   │
   └─▶ IF intermediate level:
          status stays PENDING_APPROVAL, generateBillsForBillRun is NOT called
          WorkflowOrchestrationService.advanceToNextLevel(...)
```

**Bill Run Register remains the one UI an approver uses** — per the brief's explicit instruction. The only UI change (§O) is that Bill Run Register's existing approve button/panel additionally shows "you are approving Level 2 of 3" context and is disabled/hidden for a user whose role isn't the current level's configured role (UI convenience only — the real gate is `assertCanAct`, server-side, same as today's `usePermission` being convenience-only atop `PermissionGuard`).

**Bill Run Request (Billing Readiness tab) stays view-only** — unaffected by any of this, confirmed structurally unrelated per the prior audit (`canReviewBillRun` hardcoded `false` there).

---

## I. Billing Cycle Execution Flow

Same shared `assertCanAct`/`advanceToNextLevel`/`completeInstance` calls, inserted into `BillingCycleService.approve()`/`reject()` — both of which **already** run inside `dataSource.transaction()` with `pessimistic_write` (the newest, most defensively-written of the three today), so the Workflow calls simply join that existing transaction via the same `manager` parameter already being threaded through (`billing-cycle.service.ts` already passes `manager` into `recordAudit` — the same parameter gets passed into the new Workflow calls).

One Billing Cycle-specific nuance preserved exactly: **effective-date-deferred activation.** Today, `approve()` checks `if (cycle.effectiveFrom &lt;= today) { activateVersion(...) } else { just save approval metadata, stay PENDING }`. This logic is **untouched** — it only runs at the Workflow instance's final level (same "final level only" rule as Tariff/Bill Run), and the existing `BillingCycleSchedulerService`'s midnight cron that calls `autoActivateDueVersions()` for future-dated approvals continues to run exactly as today, with zero Workflow involvement (that cron only ever touches domain rows already in a terminal "approved, pending activation" sub-state — Workflow has already finished its job by that point).

---

## J. RBAC Interaction — the exact contract

```
┌─────────────────────────────────────────────────────────────────────┐
│ HTTP request: PATCH /tariff/42/approve                              │
└───────────────────────────────┬───────────────────────────────────────┘
                                 ▼
                    JwtAuthGuard → CustomerAccessGuard → RolesGuard
                                 ▼
                    PermissionGuard: does actingUser.roleId hold
                    'TARIFF_APPROVE' OR 'TARIFF_APPROVAL_APPROVE'
                    in role_permissions?                                  ◀── RBAC's question:
                                 │                                            "CAN this role ever
                         NO ─────┤                                            approve a Tariff?"
                                 ▼
                              403 (unchanged — exactly today's behavior)
                                 │
                         YES ────┘
                                 ▼
                    TariffController.approve(id, user)
                                 ▼
                    TariffService.approve(id, user.sub)
                                 ▼
          WorkflowOrchestrationService.assertCanAct('TARIFF', id, user)   ◀── Workflow's question:
                                 │                                            "Is THIS specific user,
                         NO ─────┤                                            at THIS specific level,
                                 ▼                                            the one who should act
                   400 "Not your turn — Level 2 (Finance)                    RIGHT NOW?"
                        is currently awaiting action, you are
                        configured for Level 1 (Manager)."
                         (or: 400 "no active instance", if misconfigured)
                                 │
                         YES ────┘
                                 ▼
                    existing approve() business logic (unchanged)
```

**Workflow never re-checks `role_permissions` itself.** It only compares `actingUser.roleId` against `workflow_instance_steps.roleId` (the role snapshotted into the current step at instance-creation time). This is the precise meaning of requirement §3 ("both must pass," two independent checks) and keeps the two systems genuinely decoupled — Workflow has no dependency on `RolePermissionsService` at all, only on the JWT's already-resolved `roleId`.

**"If workflow says Finance Manager but that role does not have the required permission"** (§3, explicit scenario): this is validated **at definition-save time**, not execution time. `PUT /workflow/definitions/:workflowType`'s validation (extending today's `assertLevels`) adds one more check: for each level, does `level.roleId` hold the domain's approve action code in `role_permissions`, *right now*? If not, the save is refused with a message naming the exact level and role — e.g. `"Level 1: role 'Finance Manager' does not currently hold TARIFF_APPROVAL_APPROVE — grant it first, or choose a different role."` This mirrors the existing `assertLevels` "report every problem together" convention exactly. **It is a save-time guard, not a runtime block** — a role's permission could still be revoked *after* a definition is saved and instances are already running against it; `assertCanAct` does not re-validate this at runtime (by design — see §R, this is a documented trade-off, not an oversight) because re-checking `role_permissions` on every single approval action reintroduces the very coupling the architecture is designed to avoid. A revoked-after-the-fact mismatch simply means no one can act at that level until an admin either re-grants the permission or edits the definition (new version) — the instance safely waits rather than silently failing open or closed.

---

## K. SLA Design

**What's reused:** the exact `@Cron(EVERY_DAY_AT_MIDNIGHT)` → `createQueryBuilder` → flip-state → `auditService.record()` shape from `TariffSchedulerService`.

**What's new, and why daily cron is the right cadence here (not a dependency gap):** SLA units are `BUSINESS_DAYS`/`CALENDAR_DAYS`/`HOURS`. A new `WorkflowSlaSchedulerService` runs on a **shorter interval than midnight-only** — e.g. hourly (`@Cron(CronExpression.EVERY_HOUR)`), since an `HOURS`-unit SLA breached mid-day must not wait until the next midnight run to be detected. This is a new scheduler, following the established pattern exactly, not new infrastructure.

```
WorkflowSlaSchedulerService.checkBreaches()  [@Cron(EVERY_HOUR)]
  for each workflow_instance_steps row where:
      actedAt IS NULL                         (still waiting)
      AND slaDueAt &lt;= NOW()                    (overdue)
      AND action IS NULL                       (not already marked breached)
  →  set action = 'SLA_BREACHED', breachedAt = NOW()   (the step row is updated, NOT replaced —
                                                          the level is still waiting for a real action;
                                                          breach is a FLAG on the current step, not a transition)
  →  execute onBreach behavior:
       NOTIFY        → emit WorkflowSlaBreachedEvent(instanceId, levelOrder)
                        → async listener → MailService.sendTemplate(...) to the configured level's role
                        (reuses the proven commit-then-emit-then-best-effort-mail pattern exactly;
                         a failed send never affects the already-committed breach flag)
       ESCALATE       → advanceToNextLevel(instance, reason: 'SLA_ESCALATION') — the CURRENT level's
                        action is force-set to 'ESCALATED' (not 'APPROVED' — this is a real, visible
                        distinction in the history, never conflated with a genuine approval), and the
                        NEXT level becomes current. If there is no next level (final level escalates),
                        this is the Template's own "terminal escalation" cue — logged, flagged, and
                        the instance is held at WAITING_FOR_APPROVAL with no further auto-action; a
                        human must intervene (cancel, or an admin manually re-levels it). Never silently
                        auto-approves.
       AUTO_APPROVE   → calls the SAME domain approve() path (TariffService.approve with a system
                        actorId, e.g. a reserved "system" user id or null-actor convention already
                        used by the existing schedulers' AUTO_DEPRECATE/AUTO_EXPIRE audit actions) —
                        reuses the exact domain logic, never duplicates it. This is the one AUTO_BREACH
                        behavior the brief flags as needing explicit identification: it means a breach
                        can produce a real domain-state change with no human in the loop. This is called
                        out explicitly in §R as a risk requiring product sign-off before enabling.
```

**Dependency flagged explicitly, per the brief's own instruction:** notification delivery is "best-effort SMTP, no retry, no queue" — identical to every other email in this codebase today. If guaranteed/retried delivery is required for SLA breach alerts specifically, that is a **new infrastructure dependency** (a queue) not currently justified by this feature alone, and is called out as an open question in §R rather than silently built around.

---

## L. Concurrency / Idempotency Strategy

Directly reuses Billing Cycle's already-proven, already-bug-motivated pattern:

```ts
await this.dataSource.transaction(async (manager) => {
  const instance = await manager
    .createQueryBuilder(WorkflowInstance, 'wi')
    .setLock('pessimistic_write')
    .where('wi.id = :id', { id: instanceId })
    .getOne();

  // re-check status/currentLevelOrder INSIDE the lock, not before acquiring it —
  // this is the exact fix Billing Cycle's own doc comment describes needing
  if (instance.status !== 'WAITING_FOR_APPROVAL') {
    throw new ConflictException('This workflow instance is no longer waiting for approval.');
  }
  // ... proceed with the single state transition, still inside this same transaction
});
```

Two users calling approve on the same instance+level concurrently: the second transaction blocks on the row lock until the first commits, then re-reads a `status`/`currentLevelOrder` that has already moved — its own `assertCanAct` check (re-run *after* acquiring the lock, not before) now correctly sees "not your turn anymore" or "already completed," and fails safely with a clear `409 Conflict`, never double-advancing or double-recording.

This also directly fixes the race condition the prior audit flagged in `WorkflowService.setApprovers()` — not by changing that method (it's RBAC-side, out of scope here) but by establishing that **the new instance-mutation path does not repeat that mistake**: every `workflow_instances` write goes through this lock-then-recheck shape, never a bare find-then-save.

**Idempotency for the domain's own `approve()` call itself:** unchanged from today — `TariffService.approve()`'s existing `if (status !== PENDING) throw` is itself already an idempotency guard (a second call after the first succeeded will find `status === ACTIVE` and reject). Workflow's `assertCanAct` adds a second, independent idempotency boundary (`currentLevelOrder` has already moved past this level) — belt-and-suspenders, not redundant, since the two checks protect against different race windows (one on the domain row, one on the instance row).

---

## M. Workflow Versioning Strategy

This is the mechanism that makes §D.1's separation between `workflow_definitions` (versioned) and `workflow_instances.definitionId` (pinned) actually work:

1. **Saving a new policy never mutates an existing `workflow_definitions` row.** `PUT /workflow/definitions/:workflowType` always: (a) validates the new level set (§J's role-capability check, plus today's existing `assertLevels` rules), (b) inserts a brand-new `workflow_definitions` row with `version = currentMax + 1`, `status = 'ACTIVE'`, (c) flips the previously-`ACTIVE` row (if any) to `status = 'ARCHIVED'`, all inside one transaction.
2. **`startInstance` reads whichever definition is currently `ACTIVE` at that exact moment** and copies its `id` into the new instance's `definitionId` — a permanent, immutable pointer.
3. **An in-flight instance never re-reads the definition table again after creation.** Every level's role/department/SLA/breach values are **snapshotted into `workflow_instance_steps`** at the moment each level becomes current (not looked up live from `workflow_definition_levels` each time) — this is precisely why §9's "previous level / next level" history remains correct and stable even if an admin edits/archives the definition mid-flight. This directly satisfies requirement §11's example verbatim: an instance created under "V1: L1 Manager, L2 Finance" continues exactly on that 2-level path even after V2 ("L1 Manager, L2 Finance, L3 Director") goes live — V2 only affects instances created *after* it becomes active.
4. **No automatic migration of in-flight instances.** This is the explicit, deliberate behavior requirement §11 asks for ("unless an explicit migration mechanism exists") — none is built in this design. If a genuine need arises later to move a running instance onto a new definition version, that would be a separate, explicit admin action (not built here, flagged in §R as a possible future requirement, not a current gap).

---

## N. Audit / Process-Lineage Strategy

- **Domain-level "what happened to this business object" stays in `audit_logs`**, exactly as today (`TARIFF_APPROVE`/`TARIFF_REJECT` rows, etc.) — unchanged, no new columns, no new moduleName conventions needed.
- **Workflow-level "what happened inside the approval process" lives in `workflow_instance_steps`** (§D.4) — a structured, queryable ledger purpose-built for exactly the questions §9 lists (current level, who acted, previous/next level, rejected/returned/breached/escalated, completion time). This is additive, not a replacement for `audit_logs` — the two serve different questions and both remain useful (one is "what is true about the Tariff now," the other is "how did this specific approval journey unfold").
- Every Workflow-initiated domain action (the final-level `approve()`/`reject()` call) **also** still writes its existing `audit_logs` row exactly as today — no change to that call site's audit behavior, Workflow simply runs alongside it.

---

## O. Frontend Changes

`WorkflowList.tsx` is restructured into two clearly-separated views (per requirement §13), replacing the current single advisory-policy screen:

### O.1 Definition tab (mostly today's existing UI, relabeled)

- Same rail (Tariff / Bill Run / Billing Cycle — **note: adding Billing Cycle as a third rail tile**, since it's now in scope per requirement §7).
- Same numbered-level card, Approver/Department/SLA/On-breach fields, Add/Remove/Reorder, Discard/Save — this UI is already built and correct; it becomes the **definition editor**, now explicitly versioned (shows "Version 3 · Active since Oct 1" in the header, with a "View version history" link per §E.1's history route).
- The disclaimer text changes from "this does not yet run it" to something accurate to the new reality: **"Saving creates a new version. Approvals already in progress continue on the version they started with."** — because after this design ships, the policy genuinely does run, just not retroactively.
- Save-time validation surfaces the new §J role-capability check inline (same error-strip pattern already built): *"Level 1: role 'Finance Manager' does not currently hold TARIFF_APPROVAL_APPROVE."*

### O.2 Instance tab / panel (net new)

- A queue view: "Waiting on me" (filtered to the viewer's own role) and "All in-flight" (every `WAITING_FOR_APPROVAL` instance for the selected workflow type), each row showing business object reference, current level + role, SLA countdown (color-coded: green/amber approaching/red breached), submitted-by, submitted-on.
- Clicking a row opens the same `DetailOverlay`-style panel already built for the earlier item-queue version of this screen (removed in an earlier iteration per your "too many fields" feedback, but the pattern/component shape is directly reusable here) — showing the full step history (§D.4) as a vertical timeline: Level 1 — Manager — Approved by X on date — Level 2 — Finance — Waiting since date, SLA due in N hours.
- **No approve/reject button lives in this panel.** Per requirement §13's explicit instruction, action stays on the existing domain screens (Tariff Approval screen, Bill Run Register). This panel is read-only visibility into the live process, the same "centralized visibility, not a second action surface" principle the original Workflow module was built around.

### O.3 Domain screens (Tariff Approval screen, Bill Run Register) — small additive change

Each screen's existing approve/reject button area gains one line of context when a Workflow instance exists for that item: *"Level 2 of 3 — awaiting Finance"* — and the button is disabled (with that same message as a tooltip) if the viewer's own role doesn't match the current level, **purely as UI convenience** — the real gate is server-side `assertCanAct`, exactly mirroring how `usePermission()` is already convenience-only everywhere else in this codebase. If no Workflow instance exists for that item (no active definition for that workflow type), these screens render exactly as they do today — zero visual change for a workflow type that hasn't opted in.

---

## P. Migration Strategy

1. **Additive only, in this design.** Three new tables (§D), zero altered existing tables, zero dropped columns. `workflow_approval_levels` (today's single-version table) is **left in place, untouched**, not migrated — see note below.
2. **Opt-in rollout per workflow type.** Because `startInstance` falls back to legacy single-step behavior when no `ACTIVE` definition exists (§G), this ships dark: migrating the schema does not change any live behavior until an admin explicitly creates and activates a first `workflow_definitions` version for a given `workflowType` via the UI. Tariff, Bill Run, and Billing Cycle can each be turned on independently, on different days, by different people, with zero code redeploy required to flip one on.
3. **What happens to today's existing `workflow_approval_levels` data** (the advisory rows already configured by whoever has been testing this screen): a one-time, explicit, reviewed **data** migration (not a schema migration) copies each `workflowType`'s current rows into a new `workflow_definitions` version-1 row + matching `workflow_definition_levels`, marked `ACTIVE`. This is presented to you as a separate, explicit step before go-live — not silently folded into the schema migration — since it's the one place today's advisory data becomes load-bearing for the first time.
4. Standard idempotent-migration conventions this codebase already follows throughout (`hasTable`/`hasColumn` checks, FK added without explicit constraint names, matching `down()` methods) apply unchanged to the three new migration files this design implies.

---

## Q. Test Strategy

- **Unit**: `WorkflowOrchestrationService.assertCanAct`/`advanceToNextLevel`/`completeInstance`/`rejectInstance` in isolation, covering: no definition configured (legacy passthrough), single-level definition, multi-level happy path, wrong-role-for-current-level rejection, acting after instance already completed/rejected (idempotency), SLA breach detection math for all three units.
- **Integration**: full `TariffService.submit()→approve()×N→approve()` round trip against a real (test) DB, asserting the domain's own status only flips at the true final level, never earlier; same for Bill Run (asserting `generateBillsForBillRun` fires exactly once, only on final approval) and Billing Cycle (asserting the effective-date-deferred-activation branch still only evaluates at final-level completion).
- **Concurrency**: the same `Promise.allSettled` two-concurrent-calls pattern the Billing Cycle lock fix was presumably validated with (per its doc comment referencing this) — applied to two users attempting the same workflow-instance level simultaneously, asserting exactly one succeeds and the other gets a clean `409`.
- **Versioning**: create instance under definition V1, archive V1 and activate V2 mid-flight, assert the running instance's step sequence/roles are unaffected and still resolve against V1's snapshotted values.
- **Backward-compatibility**: explicit regression test that a workflow type with zero `workflow_definitions` rows behaves byte-for-byte identically to today's pre-Workflow approve/reject (this is the single most important test in the whole suite, since it's the guarantee the opt-in rollout strategy depends on).

---

## R. Risks / Trade-offs

1. **AUTO_APPROVE on SLA breach is a real, consequential automation** — a breach can approve a domain object with no human in the loop. This design wires it to reuse the exact existing domain `approve()` path (never a parallel/duplicate mutation), but **whether this behavior should even be enabled is a product decision, not an engineering one** — recommend it ships disabled/unselectable in the On-breach picker until explicitly signed off, even though the entity/enum already supports it (inherited from the Template's own vocabulary).
2. **Permission-vs-definition drift is detected at save-time, not continuously.** If a role's `TARIFF_APPROVAL_APPROVE` grant is revoked after a definition referencing that role is already active, running instances will simply stall at that level (no one can act) until a human notices and either re-grants the permission or republishes a new definition version. This is a deliberate trade-off (§J) to avoid re-coupling Workflow to live RBAC queries on every action — but it does mean a silent stall is possible and should be covered by an operational alert, not just left to be discovered by a confused user.
3. **No message queue exists.** SLA-breach notifications are best-effort SMTP with no retry — acceptable for an initial version per the existing codebase's own standard (every other email in this system has the same property), but worth naming explicitly as a scaling limit if breach-notification reliability becomes business-critical later.
4. **Three domain services (Tariff, Bill Run, Billing Cycle) each need a small, near-identical edit** (call `assertCanAct` at the top of approve/reject, call `advanceToNextLevel`/`completeInstance` instead of unconditionally running today's terminal logic). This is intentionally **not** abstracted into a shared decorator/interceptor in this first design — the brief's own "no duplicate business logic" principle is satisfied by the shared `WorkflowOrchestrationService` doing the actual work, while each domain service keeps an explicit, readable call site rather than hidden magic. A shared interceptor could reduce this further but would make the "do not bypass existing domain services" boundary harder to audit — recommend starting explicit, revisiting if a fourth domain arrives.
5. **No optimistic locking is introduced** (`@VersionColumn`) — this design relies entirely on pessimistic `pessimistic_write` locks, consistent with the one existing precedent in this codebase (Billing Cycle), but means every workflow-instance mutation briefly holds a row lock rather than failing-and-retrying optimistically. Given this codebase's current scale and the existing precedent, this is the lower-risk choice, not a gap.
6. **Today's live `workflow_approval_levels` table and its advisory-only API routes are not deleted in this design** — they're superseded functionally but left alongside until the explicit data-migration step (§P.3) and a deliberate decision to remove the old routes, so nothing breaks mid-migration if the frontend deploy and backend deploy don't land in the exact same moment.

---

## Direct Answers to the Brief's Framing Questions

**"RBAC checks: does the role have TARIFF_APPROVAL_APPROVE? Workflow checks: is this the right level/role?"** — Implemented exactly as two independent, sequential checks (§J): `PermissionGuard` (unchanged) then `WorkflowOrchestrationService.assertCanAct` (new). Neither re-implements the other.

**"Workflow should orchestrate/delegate to existing domain approval logic where appropriate"** — No domain service's `approve()`/`reject()` core mutation logic is rewritten; Workflow wraps it with a precondition check and a post-action "what's next" call, exactly once per domain, at the single existing call site.

**"Do NOT create WORKFLOW_APPROVE/WORKFLOW_REJECT"** — No new action codes created. All real authorization stays on the three existing domain action codes.

**"Workflow Definition vs Workflow Instance must not be confused"** — Enforced structurally: `workflow_definitions`/`workflow_definition_levels` are never read at execution time except once, at instance-creation, to snapshot values into `workflow_instance_steps`. No runtime code ever joins an in-flight instance back to the live definition table.
