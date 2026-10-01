import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Action } from '../actions/entities/action.entity';
import { RolePermission } from '../role-permissions/entities/role-permission.entity';
import { WorkflowType } from './dto/workflow.dto';

// Workflow Management -> Approval Workflows, matching CCB_Template's own scope exactly: for each
// process (Tariff, Bill Run), the real approval flow — who approves, in how many levels. No item
// list, no item detail, no approve/reject/return mutation — the Template's Approval Workflows tab
// has none of those either (it is a policy VIEW, not a queue). Each type's own domain screen
// remains the one authoritative place to see/act on real items:
//   TARIFF    -> existing Tariff Approval screen
//   BILL_RUN  -> Billing Management -> Bill Run Register
//
// Tariff has TWO action codes gating the same PATCH /tariff/:id/approve mutation via OR semantics
// (PermissionGuard — a role needs either one): TARIFF_APPROVE (Business Admin -> Tariff Config
// screen) and TARIFF_APPROVAL_APPROVE (a separate Finance-facing Tariff Approval screen), so Finance
// never has to depend on Business Admin access. setApprovers() below treats them as ONE logical
// permission — granting/revoking both together for a role — matching how the real endpoint already
// treats them. Bill Run has no such split; BILL_RUN_APPROVE alone gates its approve/reject/return.
const APPROVE_ACTION_CODES: Record<WorkflowType, string[]> = {
  [WorkflowType.TARIFF]: ['TARIFF_APPROVE', 'TARIFF_APPROVAL_APPROVE'],
  [WorkflowType.BILL_RUN]: ['BILL_RUN_APPROVE'],
};

@Injectable()
export class WorkflowService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Action) private readonly actions: Repository<Action>,
    @InjectRepository(RolePermission) private readonly rolePermissions: Repository<RolePermission>,
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
}
