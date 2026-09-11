import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Customer } from '../../customer/entities/customer.entity';
import { RegistrationDocument } from './registration-document.entity';
import { RegistrationDemand } from './registration-demand.entity';
import { RegistrationWorkflowHistoryEntry } from './registration-workflow-history.entity';
import { RegistrationVersionSnapshot } from './registration-version-snapshot.entity';
import { RegistrationRequestUnit } from './registration-request-unit.entity';
import { RegistrationRequestPropertyBilling } from './registration-request-property-billing.entity';
import { RegistrationPaymentMethod } from './registration-payment-method.entity';
import { RegistrationDeposit } from './registration-deposit.entity';
import { RegistrationCustomerDetail } from './registration-customer-detail.entity';
import { RegistrationCompanyDetail } from './registration-company-detail.entity';
import {
  ActivationInviteStatus,
  RegistrationAccountType,
  RegistrationChannel,
  RegistrationDepositStatus,
  RegistrationRequestStatus,
  RegistrationResidentType,
  RegistrationUnitType,
} from './registration-request.enums';

export {
  RegistrationChannel,
  RegistrationRequestStatus,
  RegistrationDepositStatus,
  RegistrationResidentType,
  RegistrationUnitType,
  RegistrationAccountType,
  RegistrationContactType,
  RegistrationLegalStructure,
  ActivationInviteStatus,
  isDepositResolved,
  computePortalAccess,
} from './registration-request.enums';

/**
 * The MAIN registration/application table — workflow state, account shape, and compliance only.
 * Person/contact details live on RegistrationCustomerDetail (1:1, always present); Company/Trade-
 * License/TRN details live on RegistrationCompanyDetail (1:1, present only for Corporate requests);
 * units/billing intent/payment methods/deposit each live on their own table (1:N or 1:1) — see each
 * entity's own doc comment. Keeping this table to just application-level fields is deliberate: it's
 * what changes shape/status through the workflow, while the snapshots underneath it don't.
 */
@Entity('registration_requests')
export class RegistrationRequest extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  @Column({ type: 'enum', enum: RegistrationChannel, default: RegistrationChannel.CS })
  channel!: RegistrationChannel;

  @Column({
    type: 'enum',
    enum: RegistrationRequestStatus,
    default: RegistrationRequestStatus.DRAFT,
  })
  status!: RegistrationRequestStatus;

  @Column({ name: 'submitted_date', type: 'date' })
  submittedDate!: string;

  // ── Account shape ────────────────────────────────────────────────────────────────────────────
  @Column({ name: 'account_type', type: 'enum', enum: RegistrationAccountType })
  accountType!: RegistrationAccountType;

  @Column({ name: 'resident_type', type: 'enum', enum: RegistrationResidentType })
  residentType!: RegistrationResidentType;

  @Column({ name: 'unit_type', type: 'enum', enum: RegistrationUnitType, nullable: true })
  unitType?: RegistrationUnitType | null;

  @Column({ name: 'is_resident', type: 'boolean', nullable: true })
  isResident?: boolean | null;

  // ── Units / billing intent ───────────────────────────────────────────────────────────────────
  @Column({ name: 'move_in_date', type: 'date', nullable: true })
  moveInDate?: string | null;

  // ── Compliance ────────────────────────────────────────────────────────────────────────────────
  @Column({ name: 'terms_accepted', type: 'boolean', default: false })
  termsAccepted!: boolean;

  @Column({ name: 'terms_accepted_at', type: 'datetime', nullable: true })
  termsAcceptedAt?: Date | null;

  @Column({ name: 'terms_accepted_ip', type: 'varchar', length: 45, nullable: true })
  termsAcceptedIp?: string | null;

  @Column({ name: 'manual_review_required', type: 'boolean', default: false })
  manualReviewRequired!: boolean;

  @Column({ name: 'manual_review_reasons', type: 'simple-json', nullable: true })
  manualReviewReasons?: string[] | null;

  // ── Payment methods (ongoing, masked) ────────────────────────────────────────────────────────
  // Not part of the field-per-table spec's explicit lists — kept here (not payment-method-specific,
  // not customer-detail-specific) as the request-level "does this customer want autopay" intent.
  @Column({ name: 'auto_pay_enabled', type: 'boolean', nullable: true })
  autoPayEnabled?: boolean | null;

  // ── Approval outcome / activation ────────────────────────────────────────────────────────────
  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer | null;

  @Column({
    name: 'activation_invite_status',
    type: 'enum',
    enum: ActivationInviteStatus,
    nullable: true,
  })
  activationInviteStatus?: ActivationInviteStatus | null;

  /** The Security Deposit sub-process, independent of `status` above — see
   *  RegistrationDepositStatus's own doc comment for why this is a separate column rather than
   *  values living inside `status` (as SECURITY_DEPOSIT_REQUESTED/DEPOSIT_PAID_PENDING_VERIFICATION
   *  used to). Null until the deposit decision is made (always post-approval in the current flow). */
  @Column({
    name: 'deposit_status',
    type: 'enum',
    enum: RegistrationDepositStatus,
    nullable: true,
  })
  depositStatus?: RegistrationDepositStatus | null;

  // ── Relations ─────────────────────────────────────────────────────────────────────────────────
  @OneToOne(() => RegistrationCustomerDetail, (c) => c.request, { cascade: true })
  customerDetails?: RegistrationCustomerDetail | null;

  @OneToOne(() => RegistrationCompanyDetail, (c) => c.request, { cascade: true })
  companyDetail?: RegistrationCompanyDetail | null;

  @OneToMany(() => RegistrationDocument, (doc) => doc.request, { cascade: true })
  documents!: RegistrationDocument[];

  @OneToMany(() => RegistrationWorkflowHistoryEntry, (h) => h.request, { cascade: true })
  workflowHistory!: RegistrationWorkflowHistoryEntry[];

  @OneToMany(() => RegistrationVersionSnapshot, (v) => v.request, { cascade: true })
  versions!: RegistrationVersionSnapshot[];

  @OneToMany(() => RegistrationDemand, (d) => d.request, { cascade: true })
  demands!: RegistrationDemand[];

  @OneToMany(() => RegistrationRequestUnit, (u) => u.request, { cascade: true })
  selectedUnitEntries!: RegistrationRequestUnit[];

  @OneToMany(() => RegistrationRequestPropertyBilling, (b) => b.request, { cascade: true })
  propertyBillingEntries!: RegistrationRequestPropertyBilling[];

  @OneToMany(() => RegistrationPaymentMethod, (m) => m.request, { cascade: true })
  paymentMethodEntries!: RegistrationPaymentMethod[];

  @OneToOne(() => RegistrationDeposit, (d) => d.request, { cascade: true })
  depositEntry?: RegistrationDeposit | null;
}
