import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Role } from '../role/entities/role.entity';
import { RolePermissionsService } from '../role-permissions/role-permissions.service';
import { ApprovalLevelDto, UpdateApprovalLevelsDto } from './dto/approval-level.dto';
import { WorkflowType } from './dto/workflow.dto';
import { APPROVE_ACTION_CODES } from './workflow.service';
import { WorkflowDefinition, WorkflowDefinitionStatus } from './entities/workflow-definition.entity';
import { WorkflowDefinitionLevel } from './entities/workflow-definition-level.entity';
import {
  WorkflowDepartment, WorkflowOnBreach, WorkflowSlaUnit,
} from './entities/workflow-approval-level.entity';

const SLA_UNITS = Object.values(WorkflowSlaUnit);
const ON_BREACH_BEHAVIOURS = Object.values(WorkflowOnBreach);
const DEPARTMENTS = Object.values(WorkflowDepartment);

/**
 * CRUD for the versioned Workflow DEFINITION (the recorded plan: role, department, SLA, on-breach,
 * ordered levels) — distinct from `WorkflowOrchestrationService`, which owns INSTANCE execution.
 * See `WORKFLOW_ARCHITECTURE_DESIGN.md` §D.1-D.2, §M.
 *
 * Publishing a definition NEVER mutates a prior version — `updateDefinition` always inserts a new
 * `WorkflowDefinition` row (version = currentMax + 1) and archives whichever version was previously
 * ACTIVE, inside one transaction. This is the entire mechanism behind "an in-flight instance keeps
 * using the version it started under" (§M) — `WorkflowOrchestrationService.startInstance` only
 * ever reads whichever definition is ACTIVE at that exact moment and snapshots it; this service
 * never reaches back into a running instance.
 */
@Injectable()
export class WorkflowDefinitionService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkflowDefinition) private readonly definitions: Repository<WorkflowDefinition>,
    @InjectRepository(WorkflowDefinitionLevel) private readonly definitionLevels: Repository<WorkflowDefinitionLevel>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly rolePermissionsService: RolePermissionsService,
  ) {}

  /** The current ACTIVE definition + its ordered levels, or `levels: null` if none exists yet —
   *  same "null is a real answer" contract the old advisory `getApprovalPolicy` used. */
  async getActiveDefinition(workflowType: WorkflowType) {
    const definition = await this.definitions.findOne({ where: { workflowType, status: WorkflowDefinitionStatus.ACTIVE } });
    if (!definition) {
      return { workflowType, version: null, status: null, levels: null as null };
    }

    const levels = await this.definitionLevels.find({
      where: { definitionId: definition.id },
      relations: { role: true },
      order: { levelOrder: 'ASC' },
    });

    return {
      workflowType,
      version: definition.version,
      status: definition.status,
      levels: levels.map((l) => ({
        roleId: l.roleId,
        roleName: l.role.roleName,
        department: l.department,
        slaValue: l.slaValue,
        slaUnit: l.slaUnit,
        onBreach: l.onBreach,
      })),
    };
  }

  /** Every version ever published for a workflowType, newest first — backs the "View version
   *  history" link (§E.1, §O.1). */
  async getDefinitionHistory(workflowType: WorkflowType) {
    const definitions = await this.definitions.find({ where: { workflowType }, order: { version: 'DESC' } });
    return definitions.map((d) => ({ id: d.id, version: d.version, status: d.status, createdBy: d.createdBy, createdAt: d.createdAt }));
  }

  /** Every role CURRENTLY holding the real domain approve permission for this workflow type — the
   *  exact same predicate `assertLevels` below enforces at save time (same `APPROVE_ACTION_CODES`
   *  map, same `role_permissions`/`actions` grant check), just exposed read-only so the Approver
   *  Role dropdown on the workflow-config screen can show ONLY roles that would actually pass
   *  publishNewVersion's own validation — never every role in the system, never a hardcoded role
   *  name, never a designation. A role appears here if and only if it currently holds at least one
   *  of this workflow type's approve action codes (e.g. for TARIFF: TARIFF_APPROVE OR
   *  TARIFF_APPROVAL_APPROVE) — identical OR semantics to `getApprovalFlow`'s own query, which this
   *  reuses almost verbatim. */
  async getEligibleApproverRoles(workflowType: WorkflowType): Promise<{ workflowType: WorkflowType; roles: { id: number; roleName: string }[] }> {
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

    return {
      workflowType,
      roles: rows.map((r: { role_id: number; role_name: string }) => ({ id: r.role_id, roleName: r.role_name })),
    };
  }

  /** Validates the WHOLE proposed level sequence before a single row is written — same
   *  "report every problem together, by level number" contract as the old advisory assertLevels
   *  (role existence, department/SLA-unit/on-breach enum membership, SLA a positive whole number,
   *  no two levels identical across every field), PLUS the new save-time check requirement §3/§J
   *  demands: does each level's role CURRENTLY hold the real domain approve action code? A
   *  mismatch is refused here, naming the exact level and role — this is a save-time guard, not a
   *  runtime re-check (WorkflowOrchestrationService.assertCanAct never re-queries
   *  role_permissions — see that method's own doc comment on why). */
  private async assertLevels(workflowType: WorkflowType, levels: ApprovalLevelDto[]): Promise<Omit<WorkflowDefinitionLevel, keyof import('../../common/entities/base.entity').BaseEntity | 'definition' | 'definitionId' | 'role'>[]> {
    if (!Array.isArray(levels) || levels.length === 0) {
      throw new BadRequestException('A workflow definition needs at least one level.');
    }

    const roleIds = [...new Set(levels.map((l) => l.roleId).filter((id): id is number => typeof id === 'number'))];
    const existingRoles = roleIds.length ? await this.roles.find({ where: { id: In(roleIds) } }) : [];
    const validRoleIds = new Set(existingRoles.map((r) => r.id));

    const approveActionCodes = APPROVE_ACTION_CODES[workflowType];

    const problems: string[] = [];
    const roleCapabilityCache = new Map<number, boolean>();
    const roleHasApproveCapability = async (roleId: number): Promise<boolean> => {
      if (roleCapabilityCache.has(roleId)) return roleCapabilityCache.get(roleId)!;
      let holds = false;
      for (const code of approveActionCodes) {
        if (await this.rolePermissionsService.roleHasAction(roleId, code)) { holds = true; break; }
      }
      roleCapabilityCache.set(roleId, holds);
      return holds;
    };

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const at = `Level ${i + 1}`;

      if (typeof level.roleId !== 'number' || !Number.isInteger(level.roleId) || !validRoleIds.has(level.roleId)) {
        problems.push(`${at}: unknown approver role "${String(level.roleId)}".`);
      } else if (!(await roleHasApproveCapability(level.roleId))) {
        const roleName = existingRoles.find((r) => r.id === level.roleId)?.roleName ?? String(level.roleId);
        problems.push(
          `${at}: role "${roleName}" does not currently hold the real approve permission for ${workflowType} — grant it first (Roles & Permissions), or choose a different role.`,
        );
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
    }

    if (problems.length === 0) {
      const fingerprint = (l: ApprovalLevelDto) => [l.roleId, l.department ?? null, l.slaValue, l.slaUnit, l.onBreach].join('|');
      const seenAt = new Map<string, number>();
      levels.forEach((level, i) => {
        const key = fingerprint(level);
        const firstIndex = seenAt.get(key);
        if (firstIndex === undefined) seenAt.set(key, i);
        else problems.push(`Level ${i + 1} is identical to Level ${firstIndex + 1} — remove it or change at least one field.`);
      });
    }

    // ESCALATE is meaningless on the final configured level — there is no next level to escalate
    // TO. Checked purely by array position (`i === levels.length - 1`), never a hardcoded "Level 2"
    // literal, so this refuses ESCALATE on the final level of a 1-level, 2-level, or any N-level
    // chain alike. The frontend mirrors this same rule to disable the option in the UI, but the
    // backend check here is the actual enforcement — a bypassed/direct API call must still be
    // refused (§3/§8).
    if (levels.length > 0 && levels[levels.length - 1].onBreach === WorkflowOnBreach.ESCALATE) {
      problems.push(
        `Level ${levels.length}: "Escalate to Next Level" is not allowed on the final level — there is no next level to escalate to. Choose "Notify Approver" or "Auto Approve" instead.`,
      );
    }

    if (problems.length > 0) throw new BadRequestException(problems.join(' '));

    return levels.map((l, index) => ({
      levelOrder: index,
      roleId: l.roleId as number,
      department: (l.department ?? null) as WorkflowDepartment | null,
      slaValue: l.slaValue as number,
      slaUnit: l.slaUnit as WorkflowSlaUnit,
      onBreach: l.onBreach as WorkflowOnBreach,
    }));
  }

  /** Publishes a NEW version — never edits an existing one. Archives the previously-ACTIVE version
   *  (if any) in the same transaction. Returns the new active definition in the same shape as
   *  `getActiveDefinition`. */
  async publishNewVersion(workflowType: WorkflowType, dto: UpdateApprovalLevelsDto, actorId?: number) {
    const validatedLevels = await this.assertLevels(workflowType, dto.levels);

    await this.dataSource.transaction(async (manager) => {
      const defRepo = manager.getRepository(WorkflowDefinition);
      const levelRepo = manager.getRepository(WorkflowDefinitionLevel);

      const previousActive = await defRepo.findOne({ where: { workflowType, status: WorkflowDefinitionStatus.ACTIVE } });
      const previousMax = await defRepo
        .createQueryBuilder('d')
        .where('d.workflowType = :workflowType', { workflowType })
        .select('MAX(d.version)', 'max')
        .getRawOne<{ max: number | null }>();
      const nextVersion = (previousMax?.max ?? 0) + 1;

      if (previousActive) {
        previousActive.status = WorkflowDefinitionStatus.ARCHIVED;
        await defRepo.save(previousActive);
      }

      const newDefinition = await defRepo.save(
        defRepo.create({ workflowType, version: nextVersion, status: WorkflowDefinitionStatus.ACTIVE, createdBy: actorId ?? null }),
      );

      await levelRepo.save(
        validatedLevels.map((level) => levelRepo.create({ ...level, definitionId: newDefinition.id })),
      );
    });

    return this.getActiveDefinition(workflowType);
  }
}
