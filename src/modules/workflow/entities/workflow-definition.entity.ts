import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { WorkflowType } from '../dto/workflow.dto';

export enum WorkflowDefinitionStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

/**
 * ONE VERSION of a workflow's approval-level sequence — the versioned replacement for the old
 * advisory-only `workflow_approval_levels` table (still present, untouched; see migration doc
 * comment). Exactly one row per `workflowType` may have `status = ACTIVE` at a time; publishing a
 * new version archives the previous one rather than editing it in place.
 *
 * CRITICAL INVARIANT: this table (and `WorkflowDefinitionLevel`) is read at only ONE moment —
 * when `WorkflowOrchestrationService.startInstance` creates a new `WorkflowInstance`, which
 * snapshots every level's role/department/SLA/breach value into `WorkflowInstanceStep` rows. No
 * other code path joins a running instance back to this table. Archiving or publishing a new
 * version therefore never changes an in-flight instance's behavior — see WorkflowInstance's own
 * doc comment on why `definitionId` is a permanent, write-once pointer.
 */
@Entity('workflow_definitions')
@Index(['workflowType', 'status'])
export class WorkflowDefinition extends BaseEntity {
  @Column({ type: 'varchar', length: 20 })
  workflowType!: WorkflowType;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'varchar', length: 10, default: WorkflowDefinitionStatus.ACTIVE })
  status!: WorkflowDefinitionStatus;

  @Column({ type: 'int', nullable: true })
  createdBy!: number | null;
}
