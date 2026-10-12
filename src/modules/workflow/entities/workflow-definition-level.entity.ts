import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Role } from '../../role/entities/role.entity';
import { WorkflowDefinition } from './workflow-definition.entity';
import { WorkflowDepartment, WorkflowOnBreach, WorkflowSlaUnit } from './workflow-approval-level.entity';

/**
 * ONE ordered level within a `WorkflowDefinition` version — structurally identical to the old
 * advisory `workflow_approval_levels` row shape (role/department/SLA/breach), now scoped to a
 * specific definition VERSION via `definitionId` instead of a bare `workflowType`, which is what
 * makes versioning possible (see WorkflowDefinition's own doc comment).
 *
 * `roleId` here means "which role is RESPONSIBLE for this level" — it is NOT an RBAC grant. Saving
 * a definition does not touch `role_permissions`; WorkflowService.setApprovers (unchanged) remains
 * the only path that grants the real TARIFF_APPROVAL_APPROVE/BILL_RUN_APPROVE/
 * BILLING_CYCLE_APPROVAL_APPROVE permission. At definition-save time,
 * WorkflowDefinitionService.assertLevels additionally checks that this role CURRENTLY holds the
 * matching real action code — a save-time warning/guard, not a runtime re-check (see
 * WorkflowOrchestrationService's own doc comment on why the runtime check only compares roleId,
 * never re-queries role_permissions).
 */
@Entity('workflow_definition_levels')
@Index(['definitionId', 'levelOrder'])
export class WorkflowDefinitionLevel extends BaseEntity {
  @Column()
  definitionId!: number;

  @ManyToOne(() => WorkflowDefinition, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'definitionId' })
  definition!: WorkflowDefinition;

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
