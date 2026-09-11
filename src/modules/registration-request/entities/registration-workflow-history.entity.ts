import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { RegistrationRequest } from './registration-request.entity';

/** Append-only audit enum — spec §4.2.4 / §6.7. Never mutate or reorder an existing entry; append
 *  exactly one row per event. */
export enum RegistrationWorkflowAction {
  SUBMITTED_FOR_REVIEW = 'Submitted for Review',
  RETURNED_TO_RESIDENT = 'Returned to Resident for Correction',
  RESUBMITTED = 'Resubmitted',
  SUBMITTED_FOR_APPROVAL = 'Submitted for Approval',
  SECURITY_DEPOSIT_REQUESTED = 'Security Deposit Requested',
  SECURITY_DEPOSIT_NOT_REQUIRED = 'Security Deposit — Not required',
  DEPOSIT_PAID = 'Deposit Paid',
  DEPOSIT_VERIFIED = 'Deposit Verified',
  RETURNED_TO_CS = 'Returned to CS for Correction',
  DEMAND_REVERSED = 'Demand Reversed',
  BUSINESS_APPROVED = 'Business Approved',
  REJECTED = 'Rejected',
  SENT_TO_RESIDENT = 'Sent to Resident',
}

@Entity('registration_workflow_history')
export class RegistrationWorkflowHistoryEntry extends BaseEntity {
  @ManyToOne(() => RegistrationRequest, (r) => r.workflowHistory, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: RegistrationRequest;

  @Column({ name: 'action_type', type: 'enum', enum: RegistrationWorkflowAction })
  actionType!: RegistrationWorkflowAction;

  @Column({ name: 'action_by', type: 'varchar', length: 160 })
  actionBy!: string;

  @Column({ name: 'action_at', type: 'datetime' })
  actionAt!: Date;

  @Column({ type: 'text', nullable: true })
  comments?: string | null;
}
