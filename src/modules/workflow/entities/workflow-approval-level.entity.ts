import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Role } from '../../role/entities/role.entity';
import { WorkflowType } from '../dto/workflow.dto';

export enum WorkflowSlaUnit {
  BUSINESS_DAYS = 'BUSINESS_DAYS',
  CALENDAR_DAYS = 'CALENDAR_DAYS',
  HOURS = 'HOURS',
}

export enum WorkflowOnBreach {
  NOTIFY = 'NOTIFY',
  ESCALATE = 'ESCALATE',
  AUTO_APPROVE = 'AUTO_APPROVE',
}

// Mirrors CCB_Template's attributesService.ts Department union exactly (its own canonical set for
// this concept) — a closed, Template-owned vocabulary with no CCB API equivalent (no
// department/business-unit entity exists anywhere in this codebase), so it is a plain string enum
// here too rather than a new master-data table for five fixed values.
export enum WorkflowDepartment {
  BILLING = 'BILLING',
  FIELD_OPERATIONS = 'FIELD_OPERATIONS',
  CONTRACT_MANAGEMENT = 'CONTRACT_MANAGEMENT',
  CUSTOMER_MANAGEMENT = 'CUSTOMER_MANAGEMENT',
  CS = 'CS',
}

/**
 * ONE approval level in a recorded POLICY — reproduces CCB_Template's ApprovalLevel/
 * approvalWorkflowService.ts exactly: a role, an optional department scope, an SLA, and what
 * happens on breach. `levelOrder` is 0-based position within `workflowType` (level 1 is
 * levelOrder=0) — never a persisted "level number" the array order could drift out of sync with,
 * same reasoning as the Template's own doc comment on why ApprovalLevel carries no level field.
 *
 * THIS IS A POLICY RECORD ONLY. Exactly like the Template it reproduces, saving a level here does
 * NOT grant, revoke, or otherwise touch the real approve permission (`role_permissions` /
 * `TARIFF_APPROVE` / `TARIFF_APPROVAL_APPROVE` / `BILL_RUN_APPROVE`, written by
 * WorkflowService.setApprovers) — the two are deliberately decoupled. TariffService.approve()/
 * BillRunService.approve() remain the one real decision, gated only by role_permissions; nothing
 * here routes, measures an SLA, or escalates anything. See WorkflowService's own doc comment for
 * the full disclosure this mirrors from the Template's own "the engine is a backend dependency"
 * language.
 */
@Entity('workflow_approval_levels')
@Index(['workflowType', 'levelOrder'])
export class WorkflowApprovalLevel extends BaseEntity {
  @Column({ type: 'varchar', length: 20 })
  workflowType!: WorkflowType;

  @Column({ type: 'int' })
  levelOrder!: number;

  @Column()
  roleId!: number;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role!: Role;

  @Column({ type: 'varchar', length: 30, nullable: true })
  department!: WorkflowDepartment | null;

  @Column({ type: 'int' })
  slaValue!: number;

  @Column({ type: 'varchar', length: 20 })
  slaUnit!: WorkflowSlaUnit;

  @Column({ type: 'varchar', length: 20 })
  onBreach!: WorkflowOnBreach;
}
