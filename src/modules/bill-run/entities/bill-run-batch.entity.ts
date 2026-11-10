import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { BillRun } from './bill-run.entity';

// Groups multiple BillRun rows submitted together via the estate-wide "batch" flow — an individual
// submission has no BillRunBatch at all (BillRun.batchId stays null). The batch itself carries no
// status of its own: its state is always derived live from its member BillRun rows' statuses (see
// BillRunService.getBatchSummary), so there is exactly one place a run's real status can ever live.
@Entity('bill_run_batches')
export class BillRunBatch extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy?: User | null;

  @Column({ name: 'submitted_by_id', nullable: true })
  submittedById?: number | null;

  @Column({ name: 'submitted_on', type: 'datetime' })
  submittedOn!: Date;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null;

  @OneToMany(() => BillRun, (billRun) => billRun.batch)
  billRuns!: BillRun[];
}
