import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { WorkflowType } from '../dto/workflow.dto';
import { WorkflowDefinition } from './workflow-definition.entity';

export enum WorkflowInstanceStatus {
  WAITING_FOR_APPROVAL = 'WAITING_FOR_APPROVAL',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/**
 * ONE real approval journey for ONE real business object (a TariffVersion, BillRun, or
 * BillingCycleVersion row) — created the moment that object is submitted for approval, closed
 * when the final level approves (COMPLETED), any level rejects (REJECTED), or the underlying
 * object is withdrawn/superseded before completion (CANCELLED).
 *
 * `definitionId` is a PERMANENT, WRITE-ONCE POINTER set at creation and never reassigned — this is
 * the entire mechanism behind "a running instance always keeps using the definition version it
 * started under" (requirement: workflow versioning must never silently reshape an in-flight
 * instance). Every level's actual role/department/SLA/breach values are copied into
 * `WorkflowInstanceStep` rows at the moment each level activates — this entity and
 * `definitionId` are consulted only once, at `startInstance` time, never again during the
 * instance's life.
 *
 * At most one instance may be `WAITING_FOR_APPROVAL` per (workflowType, businessObjectId) at a
 * time — enforced by `WorkflowOrchestrationService.startInstance` reading-then-checking inside a
 * transaction (not a DB-level partial unique index, since this codebase's MySQL version/TypeORM
 * setup has no established partial-index convention; see that method's own doc comment). Multiple
 * COMPLETED/REJECTED/CANCELLED historical rows for the same business object are expected and
 * normal (one per resubmission attempt).
 */
@Entity('workflow_instances')
@Index(['workflowType', 'businessObjectId', 'status'])
export class WorkflowInstance extends BaseEntity {
  @Column({ type: 'varchar', length: 20 })
  workflowType!: WorkflowType;

  @Column()
  businessObjectId!: number;

  @Column()
  definitionId!: number;

  @ManyToOne(() => WorkflowDefinition, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'definitionId' })
  definition!: WorkflowDefinition;

  @Column({ type: 'int', nullable: true })
  currentLevelOrder!: number | null;

  @Column({ type: 'varchar', length: 20, default: WorkflowInstanceStatus.WAITING_FOR_APPROVAL })
  status!: WorkflowInstanceStatus;

  @Column({ type: 'int', nullable: true })
  submittedById!: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'submittedById' })
  submittedBy?: User | null;

  @Column({ type: 'datetime', precision: 6 })
  submittedAt!: Date;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  completedAt!: Date | null;
}
