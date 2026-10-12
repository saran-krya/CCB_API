import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Role } from '../../role/entities/role.entity';
import { User } from '../../user/entities/user.entity';
import { WorkflowInstance } from './workflow-instance.entity';
import { WorkflowSlaUnit } from './workflow-approval-level.entity';

export enum WorkflowStepAction {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETURNED = 'RETURNED',
  SLA_BREACHED = 'SLA_BREACHED',
  ESCALATED = 'ESCALATED',
}

/**
 * ONE level's execution record within a `WorkflowInstance` — the process-lineage ledger. A row is
 * inserted the moment a level becomes current (`activatedAt` set, `slaDueAt` computed from the
 * SNAPSHOTTED `slaValue`/`slaUnit` — copied from `WorkflowDefinitionLevel` at instance-creation
 * time, never re-read live) and updated in place when that level is acted upon (`actedBy`/
 * `action`/`actedAt`/`notes` filled in). The next level's activation inserts a NEW row rather than
 * reusing this one — `levelOrder` plus `instanceId` gives a complete, queryable timeline answering
 * every process-lineage question (current level, who acted, when, previous/next level via ordering,
 * rejected/returned/breached/escalated via `action`).
 *
 * `roleId` here is the role SNAPSHOTTED from the definition at the moment this step was created —
 * not a live join to `WorkflowDefinitionLevel`. If an admin edits/archives the definition while
 * this instance is mid-flight, this row's `roleId` is unaffected (see WorkflowInstance's own doc
 * comment on the write-once `definitionId` pointer — this is the same principle applied per-step).
 *
 * `SLA_BREACHED` and `ESCALATED` are never recorded on the SAME row as `APPROVED`/`REJECTED` — a
 * breach flags the CURRENT, still-open step (action stays null; see
 * `WorkflowSlaSchedulerService`'s own doc comment for why breach is tracked as a side flag rather
 * than a terminal action) while `ESCALATED` is the terminal action recorded on a step the SLA
 * scheduler force-closed on the configured process's behalf, distinct from a genuine human
 * `APPROVED` — never conflate the two when reading history.
 */
@Entity('workflow_instance_steps')
@Index(['instanceId', 'levelOrder'])
@Index(['slaDueAt'])
export class WorkflowInstanceStep extends BaseEntity {
  @Column()
  instanceId!: number;

  @ManyToOne(() => WorkflowInstance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instanceId' })
  instance!: WorkflowInstance;

  @Column({ type: 'int' })
  levelOrder!: number;

  @Column()
  roleId!: number;

  @ManyToOne(() => Role, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'roleId' })
  role!: Role;

  @Column({ type: 'int' })
  slaValue!: number;

  @Column({ type: 'varchar', length: 20 })
  slaUnit!: WorkflowSlaUnit;

  @Column({ type: 'datetime', precision: 6 })
  activatedAt!: Date;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  slaDueAt!: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  slaBreachedAt!: Date | null;

  @Column({ type: 'int', nullable: true })
  actedById!: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actedById' })
  actedBy?: User | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  action!: WorkflowStepAction | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  actedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
