import { BadRequestException, GoneException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { isAdministratorRoleName } from '../../common/security/administrator-roles';
import { APPROVE_ACTION_CODES } from '../iam/business-approval-actions';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { Role } from '../role/entities/role.entity';
import { ApprovalLevelDto, UpdateApprovalLevelsDto } from './dto/approval-level.dto';
import { WorkflowType } from './dto/workflow.dto';
import {
  WorkflowApprovalLevel, WorkflowDepartment, WorkflowOnBreach, WorkflowSlaUnit,
} from './entities/workflow-approval-level.entity';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';
import { SORT_ORDER } from '../../common/constants/sort.constants';

const SLA_UNITS = Object.values(WorkflowSlaUnit);
const ON_BREACH_BEHAVIOURS = Object.values(WorkflowOnBreach);
const DEPARTMENTS = Object.values(WorkflowDepartment);

// Workflow Management -> Approval Workflows, matching CCB_Template's own scope exactly: for each
// process (Tariff, Bill Run, Billing Cycle), the real approval flow — who approves, in how many
// levels. Each type's own domain screen remains the one authoritative place to see/act on real
// items:
//   TARIFF         -> existing Tariff Approval screen
//   BILL_RUN       -> Billing Management -> Bill Run Register
//   BILLING_CYCLE  -> existing Billing Cycle approval screen
//
// Tariff and Billing Cycle each USED TO have two action codes gating the same approve mutation via
// OR semantics (the Business-Admin-screen code and a separate Finance-facing code) — these were
// confirmed to be literal duplicates for the same capability and consolidated onto one surviving
// code each by 1792800000000-ConsolidateDuplicateActionCodes.ts (see resource-catalog.ts's own doc
// comment for the full before/after map). A role is an eligible approver for a workflow type while it
// holds ANY code in that type's array through its Policies (IamService.getRoleIdsHoldingAnyAction), so an
// array may hold several codes. Bill Run was never split; BILL_RUN_APPROVE alone gates its
// approve/reject/return.
//
// Declared in the IAM module (business-approval-actions.ts) so IamService can use the same map for its
// approver-eligibility checks without importing this module; re-exported here for every existing import.
export { APPROVE_ACTION_CODES };

// Centralizes "which real domain action code(s) let a user see a workflowType's RUNTIME state"
// (GET /workflow/instances/...) — deliberately separate from WORKFLOW_VIEW, which gates
// Workflow CONFIGURATION (GET/PUT /workflow/definitions/...) only. The two are different
// questions: "can you define how approval works" vs "can you see where THIS record's approval
// currently stands." Each list is that domain's real view code(s) plus its approve code(s) —
// approve already OR-implies view everywhere else in this codebase (e.g. TariffController's own
// findOne is gated on TARIFF_VIEW alone, post-consolidation; nothing here invents a new permission
// or grants more than a user already effectively has via their real domain access). See
// WorkflowOrchestrationService.assertCanViewRuntime for the actual check this map feeds.
export const RUNTIME_VIEW_ACTION_CODES: Record<WorkflowType, string[]> = {
  [WorkflowType.TARIFF]: [ACTION_CODES.TARIFF_VIEW, ...APPROVE_ACTION_CODES[WorkflowType.TARIFF]],
  [WorkflowType.BILL_RUN]: [ACTION_CODES.BILL_RUN_VIEW, ...APPROVE_ACTION_CODES[WorkflowType.BILL_RUN]],
  [WorkflowType.BILLING_CYCLE]: [ACTION_CODES.VIEW_BILLING_CYCLE, ...APPROVE_ACTION_CODES[WorkflowType.BILLING_CYCLE]],
};

@Injectable()
export class WorkflowService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(WorkflowApprovalLevel) private readonly approvalLevels: Repository<WorkflowApprovalLevel>,
    private readonly rolePermissionsService: RolePermissionsService,
  ) {}

  /** The real, single-step approval flow for a workflow type — used by the Workflow screen's
   *  Approval Flow summary (visual language reproduced from CCB_Template's Business Admin ->
   *  Workflow Management -> Approval Workflows tab, but populated with THIS project's real data,
   *  never the Template's example multi-level/SLA/escalation policy). Neither Tariff nor Bill Run
   *  has a multi-level/SLA/escalation concept in this codebase (confirmed in the architecture
   *  discovery that preceded this module: TariffService.approve()/BillRunService.approve() each
   *  gate on a single PENDING status, decided once by any role holding the approve action — no
   *  level, no SLA, no escalation column or logic exists anywhere in either entity/service). So
   *  this always returns exactly ONE level, naming the REAL roles currently granted the real
   *  approve action code(s) — never an invented SLA duration or escalation behavior. */
  async getApprovalFlow(workflowType: WorkflowType) {
    const actionCodes = APPROVE_ACTION_CODES[workflowType];
    if (!actionCodes) throw new BadRequestException(`Unsupported workflow type "${workflowType}"`);

    // Policy-based, exactly like real authorization: the roles whose Policies currently grant the approve code(s) —
    // never the legacy role_permissions table, which no authorization decision reads any more. SUPER_ADMIN is
    // never listed (it is not a business approver).
    const eligibleRoleIds = await this.rolePermissionsService.getRoleIdsHoldingAnyAction(actionCodes);
    const eligibleRoles = eligibleRoleIds.length
      ? await this.roles.find({ where: { id: In(eligibleRoleIds) }, order: { roleName: SORT_ORDER.ASC } })
      : [];
    const approverRoles: string[] = eligibleRoles.map((r) => r.roleName);
    const approverRoleIds: number[] = eligibleRoles.map((r) => r.id);

    return {
      workflowType,
      levels: [
        {
          level: 1,
          approverRoles,
          approverRoleIds,
        },
      ],
    };
  }

  /** RETIRED. This used to write the approve permission into the legacy `role_permissions` table, which no
   *  authorization decision has read since the IAM cutover — so it changed who appears in this screen but never who
   *  can actually approve, and let the two drift apart. A role may approve a workflow only through the Policies
   *  attached to it; which roles act at each level is configured with PUT definitions/:workflowType, whose Approver
   *  Role dropdown (GET definitions/:workflowType/eligible-approver-roles) lists exactly the roles the backend
   *  accepts. Refused loudly rather than silently doing nothing; the route stays so an old client gets this message. */
  async setApprovers(workflowType: WorkflowType, _roleIds: number[]): Promise<never> {
    throw new GoneException(
      `Approvers for ${workflowType} are no longer set by writing role permissions. A role approves only through the ` +
        'policies attached to it: grant the approve permission to the role in a policy, then choose the role at the right ' +
        'level of the workflow definition (PUT /workflow/definitions/:workflowType).',
    );
  }

  /** The recorded POLICY for a workflow type — reproduces CCB_Template's getApprovalWorkflow exactly,
   *  including the `null` "nothing configured yet" answer (see WorkflowApprovalLevel entity's own
   *  doc comment on why this is a policy record, not the real approve permission). Ordered by
   *  levelOrder; role display name is joined so a panel never has to resolve it separately. */
  async getApprovalPolicy(workflowType: WorkflowType) {
    const rows = await this.approvalLevels.find({
      where: { workflowType },
      relations: { role: true },
      order: { levelOrder: SORT_ORDER.ASC },
    });

    if (rows.length === 0) {
      return { workflowType, levels: null };
    }

    return {
      workflowType,
      levels: rows.map((r) => ({
        roleId: r.roleId,
        roleName: r.role.roleName,
        department: r.department,
        slaValue: r.slaValue,
        slaUnit: r.slaUnit,
        onBreach: r.onBreach,
      })),
    };
  }

  /** Validates the WHOLE proposed sequence before a single level is written — reproduces
   *  CCB_Template's `_assertLevels` exactly, including its "report every problem together, by
   *  level number, in one message" contract (never throw on the first problem found, since a
   *  builder editing four levels should learn about all four problems in one refusal).
   *
   *  - At least one level (checked by the DTO's @ArrayMinSize, but re-asserted here since this is
   *    the single source of truth the Template's own method is).
   *  - Role ids checked against the LIVE roles table, not a cached list — one query for the whole
   *    batch, never one per level.
   *  - Department: `null` (any department) is valid; otherwise must be a known value.
   *  - SLA must be a finite, positive INTEGER — same deliberate call as the Template's own doc
   *    comment: `'HOURS'` exists precisely so a sub-day SLA is expressible, so a fractional
   *    business-day value buys nothing and has no agreed meaning to round.
   *  - SLA unit and on-breach behaviour validated as known enum members, since they arrive as
   *    strings over HTTP and an unrecognised one would be stored, then render as a blank label.
   *  - No two levels may be IDENTICAL across every field (same role AND department AND SLA value
   *    AND SLA unit AND on-breach). This is stricter than the Template's own rule — the Template
   *    explicitly allows a REPEATED ROLE ("a second sign-off at a higher threshold is a real
   *    policy"), and that still applies here too: same role with a different department scope,
   *    SLA, or breach behaviour is a legitimate second gate and saves fine. Only a level that adds
   *    literally nothing beyond an earlier one (every field identical) is refused — the most common
   *    way to reach this by accident is clicking "Add level" and saving before changing anything,
   *    since a fresh level defaults to the same values as the first. */
  private async assertLevels(levels: ApprovalLevelDto[]): Promise<WorkflowApprovalLevel[]> {
    if (!Array.isArray(levels) || levels.length === 0) {
      throw new BadRequestException('An approval workflow needs at least one level.');
    }

    const roleIds = [...new Set(levels.map((l) => l.roleId).filter((id): id is number => typeof id === 'number'))];
    const existingRoles = roleIds.length ? await this.roles.find({ where: { id: In(roleIds) } }) : [];
    const validRoleIds = new Set(existingRoles.map((r) => r.id));
    // SUPER_ADMIN is a system-administration role: it can never be a workflow approver.
    const administratorRoleNames = new Map(existingRoles.filter((r) => isAdministratorRoleName(r.roleName)).map((r) => [r.id, r.roleName]));

    const problems: string[] = [];
    levels.forEach((level, i) => {
      const at = `Level ${i + 1}`;

      if (typeof level.roleId !== 'number' || !Number.isInteger(level.roleId) || !validRoleIds.has(level.roleId)) {
        problems.push(`${at}: unknown approver role "${String(level.roleId)}".`);
      } else if (administratorRoleNames.has(level.roleId)) {
        problems.push(`${at}: ${administratorRoleNames.get(level.roleId)} is a system-administration role and cannot be a workflow approver.`);
      }
      if (level.department !== null && level.department !== undefined && !DEPARTMENTS.includes(level.department as WorkflowDepartment)) {
        problems.push(`${at}: unknown department "${String(level.department)}".`);
      }
      if (typeof level.slaValue !== 'number' || !Number.isFinite(level.slaValue) || !Number.isInteger(level.slaValue) || level.slaValue <= 0) {
        problems.push(`${at}: the SLA must be a whole number greater than zero.`);
      }
      if (!SLA_UNITS.includes(level.slaUnit as WorkflowSlaUnit)) {
        problems.push(`${at}: unknown SLA unit "${String(level.slaUnit)}".`);
      }
      if (!ON_BREACH_BEHAVIOURS.includes(level.onBreach as WorkflowOnBreach)) {
        problems.push(`${at}: unknown on-breach behaviour "${String(level.onBreach)}".`);
      }
    });

    // Duplicate check runs only once every level is otherwise well-formed — comparing a level with
    // a bad/missing field against its neighbours would either crash or report a misleading
    // "duplicate" for two levels that are both broken in the same way, not actually identical.
    if (problems.length === 0) {
      const fingerprint = (l: ApprovalLevelDto) =>
        [l.roleId, l.department ?? null, l.slaValue, l.slaUnit, l.onBreach].join('|');
      const seenAt = new Map<string, number>();
      levels.forEach((level, i) => {
        const key = fingerprint(level);
        const firstIndex = seenAt.get(key);
        if (firstIndex === undefined) {
          seenAt.set(key, i);
        } else {
          problems.push(`Level ${i + 1} is identical to Level ${firstIndex + 1} — remove it or change at least one field.`);
        }
      });
    }

    if (problems.length > 0) throw new BadRequestException(problems.join(' '));

    return levels.map((l) => ({
      roleId: l.roleId as number,
      department: (l.department ?? null) as WorkflowDepartment | null,
      slaValue: l.slaValue as number,
      slaUnit: l.slaUnit as WorkflowSlaUnit,
      onBreach: l.onBreach as WorkflowOnBreach,
    })) as WorkflowApprovalLevel[];
  }

  /** REPLACE a workflow type's whole recorded policy — mirrors CCB_Template's updateApprovalLevels
   *  contract exactly: the caller submits the complete intended sequence (never a diff/merge, since
   *  an approval policy's meaning IS its order), validated as one batch by assertLevels above, and
   *  the whole write is one transaction so a bad level never leaves a partial sequence behind.
   *
   *  THIS WRITES NOTHING TO role_permissions. See WorkflowApprovalLevel entity's own doc comment —
   *  this is a policy record only, deliberately decoupled from the real approve permission that
   *  WorkflowService.setApprovers manages. */
  async updateApprovalPolicy(workflowType: WorkflowType, dto: UpdateApprovalLevelsDto) {
    const validatedLevels = await this.assertLevels(dto.levels);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(WorkflowApprovalLevel);
      await repo.delete({ workflowType });
      await repo.save(
        validatedLevels.map((level, index) =>
          repo.create({
            workflowType,
            levelOrder: index,
            roleId: level.roleId,
            department: level.department,
            slaValue: level.slaValue,
            slaUnit: level.slaUnit,
            onBreach: level.onBreach,
          }),
        ),
      );
    });

    return this.getApprovalPolicy(workflowType);
  }
}
