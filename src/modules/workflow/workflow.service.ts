import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Action } from '../actions/entities/action.entity';
import { RolePermission } from '../role-permissions/entities/role-permission.entity';
import { Role } from '../role/entities/role.entity';
import { ApprovalLevelDto, UpdateApprovalLevelsDto } from './dto/approval-level.dto';
import { WorkflowType } from './dto/workflow.dto';
import {
  WorkflowApprovalLevel, WorkflowDepartment, WorkflowOnBreach, WorkflowSlaUnit,
} from './entities/workflow-approval-level.entity';

const SLA_UNITS = Object.values(WorkflowSlaUnit);
const ON_BREACH_BEHAVIOURS = Object.values(WorkflowOnBreach);
const DEPARTMENTS = Object.values(WorkflowDepartment);

// Workflow Management -> Approval Workflows, matching CCB_Template's own scope exactly: for each
// process (Tariff, Bill Run, Billing Cycle), the real approval flow — who approves, in how many
// levels. Each type's own domain screen remains the one authoritative place to see/act on real
// items:
//   TARIFF         -> existing Tariff Approval screen
//   BILL_RUN       -> Billing Management -> Bill Run Register
//   BILLING_CYCLE  -> existing Billing Cycle Finance approval screen
//
// Tariff and Billing Cycle each USED TO have two action codes gating the same approve mutation via
// OR semantics (the Business-Admin-screen code and a separate Finance-facing code) — these were
// confirmed to be literal duplicates for the same capability and consolidated onto one surviving
// code each by 1792800000000-ConsolidateDuplicateActionCodes.ts (see resource-catalog.ts's own doc
// comment for the full before/after map). setApprovers() grants/revokes whatever this array holds
// for a role; it was already written to treat multiple codes as one logical permission, so
// shrinking to a single code per type needed no logic change here. Bill Run was never split;
// BILL_RUN_APPROVE alone gates its approve/reject/return.
export const APPROVE_ACTION_CODES: Record<WorkflowType, string[]> = {
  [WorkflowType.TARIFF]: ['TARIFF_APPROVE'],
  [WorkflowType.BILL_RUN]: ['BILL_RUN_APPROVE'],
  [WorkflowType.BILLING_CYCLE]: ['BILLING_CYCLE_APPROVE'],
};

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
  [WorkflowType.TARIFF]: ['TARIFF_VIEW', ...APPROVE_ACTION_CODES[WorkflowType.TARIFF]],
  [WorkflowType.BILL_RUN]: ['BILL_RUN_VIEW', ...APPROVE_ACTION_CODES[WorkflowType.BILL_RUN]],
  [WorkflowType.BILLING_CYCLE]: ['VIEW_BILLING_CYCLE', ...APPROVE_ACTION_CODES[WorkflowType.BILLING_CYCLE]],
};

@Injectable()
export class WorkflowService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Action) private readonly actions: Repository<Action>,
    @InjectRepository(RolePermission) private readonly rolePermissions: Repository<RolePermission>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(WorkflowApprovalLevel) private readonly approvalLevels: Repository<WorkflowApprovalLevel>,
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

    const rows = await this.dataSource.query(
      `SELECT DISTINCT r.id AS role_id, r.role_name
       FROM roles r
       JOIN role_permissions rp ON rp.roleId = r.id
       JOIN actions a ON a.id = rp.actionId
       WHERE a.code IN (${actionCodes.map(() => '?').join(',')}) AND a.deleted_at IS NULL
       ORDER BY r.role_name ASC`,
      actionCodes,
    );
    const approverRoles: string[] = rows.map((r: { role_name: string }) => r.role_name);
    const approverRoleIds: number[] = rows.map((r: { role_id: number }) => r.role_id);

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

  /** Sets the COMPLETE list of roles that may approve this workflow type — adds a grant for every
   *  roleId in the list that doesn't already have one, and removes the grant for every role that
   *  currently has one but isn't in the list. Scoped to ONLY the approve action code(s) for this
   *  workflow type; never touches any other permission a role holds (unlike
   *  RolePermissionsService.updateRolePermissions/savePermissions, which wholesale delete-and-rebuild
   *  a role's ENTIRE permission set and would be unsafe to reuse for this one-action edit).
   *
   *  For Tariff, writes/removes BOTH action codes together per role (see this module's own doc
   *  comment above) — a role is "a Tariff approver" as one fact from this screen's point of view,
   *  even though the real endpoint accepts either code alone. */
  async setApprovers(workflowType: WorkflowType, roleIds: number[]): Promise<{ workflowType: WorkflowType; approverRoleIds: number[] }> {
    const actionCodes = APPROVE_ACTION_CODES[workflowType];
    if (!actionCodes) throw new BadRequestException(`Unsupported workflow type "${workflowType}"`);

    const uniqueRoleIds = [...new Set(roleIds)];

    const actions = await this.actions.find({
      where: { code: In(actionCodes) },
      relations: { screen: { subModule: true, pModule: true } },
    });
    if (actions.length !== actionCodes.length) {
      throw new BadRequestException(`One or more approve actions for "${workflowType}" are missing or inactive — cannot edit approvers`);
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RolePermission);

      for (const action of actions) {
        const screen = action.screen;
        if (!screen) throw new BadRequestException(`Action "${action.code}" has no screen — cannot resolve its module chain`);
        const moduleId = screen.subModule?.pModuleId ?? screen.pModuleId;
        if (!moduleId) throw new BadRequestException(`Action "${action.code}"'s screen has no resolvable module — cannot resolve its module chain`);

        const existing = await repo.find({ where: { actionId: action.id } });
        const existingRoleIds = new Set(existing.map((e) => e.roleId));

        const toAdd = uniqueRoleIds.filter((id) => !existingRoleIds.has(id));
        const toRemove = existing.filter((e) => !uniqueRoleIds.includes(e.roleId));

        if (toAdd.length > 0) {
          await repo.save(
            toAdd.map((roleId) =>
              repo.create({
                roleId,
                moduleId,
                subModuleId: screen.subModuleId ?? null,
                screenId: screen.id,
                actionId: action.id,
              }),
            ),
          );
        }
        if (toRemove.length > 0) {
          await repo.remove(toRemove);
        }
      }
    });

    return { workflowType, approverRoleIds: uniqueRoleIds };
  }

  /** The recorded POLICY for a workflow type — reproduces CCB_Template's getApprovalWorkflow exactly,
   *  including the `null` "nothing configured yet" answer (see WorkflowApprovalLevel entity's own
   *  doc comment on why this is a policy record, not the real approve permission). Ordered by
   *  levelOrder; role display name is joined so a panel never has to resolve it separately. */
  async getApprovalPolicy(workflowType: WorkflowType) {
    const rows = await this.approvalLevels.find({
      where: { workflowType },
      relations: { role: true },
      order: { levelOrder: 'ASC' },
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

    const problems: string[] = [];
    levels.forEach((level, i) => {
      const at = `Level ${i + 1}`;

      if (typeof level.roleId !== 'number' || !Number.isInteger(level.roleId) || !validRoleIds.has(level.roleId)) {
        problems.push(`${at}: unknown approver role "${String(level.roleId)}".`);
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
