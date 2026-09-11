import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { RegistrationRequest } from './registration-request.entity';

export enum RegistrationDemandStatus {
  RAISED = 'Raised',
  PAID = 'Paid',
  VERIFIED = 'Verified',
  REVERSED = 'Reversed',
}

export enum RegistrationDemandComponentType {
  SECURITY_DEPOSIT = 'Security Deposit',
  ACTIVATION_FEE = 'Activation Fee',
}

/** One line of the demand, per unit + tariff — spec §4.2.3. Not queried independently — lives as
 *  JSON on the owning demand row. */
export interface RegistrationDemandComponent {
  unitId: number;
  tariffCode: string;
  type: RegistrationDemandComponentType;
  amount: number;
  vatApplicable: boolean;
  vatAmount: number;
  refundable: boolean;
}

/**
 * The tariff-derived security-deposit / activation-fee demand raised by CS (spec §4.2.3, §6.3).
 * `demandNumber` is generated via the shared transaction-numbering sequence (see
 * `TxnSequenceService`).
 */
@Entity('registration_demands')
export class RegistrationDemand extends BaseEntity {
  @ManyToOne(() => RegistrationRequest, (r) => r.demands, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: RegistrationRequest;

  @Column({ name: 'demand_number', type: 'varchar', length: 30, unique: true })
  demandNumber!: string;

  @Column({ type: 'simple-json' })
  components!: RegistrationDemandComponent[];

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal!: number;

  @Column({ name: 'vat_total', type: 'decimal', precision: 12, scale: 2 })
  vatTotal!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total!: number;

  @Column({
    type: 'enum',
    enum: RegistrationDemandStatus,
    default: RegistrationDemandStatus.RAISED,
  })
  status!: RegistrationDemandStatus;

  @Column({ name: 'raised_date', type: 'datetime', nullable: true })
  raisedDate?: Date | null;

  @Column({ name: 'paid_date', type: 'datetime', nullable: true })
  paidDate?: Date | null;

  @Column({ name: 'verified_date', type: 'datetime', nullable: true })
  verifiedDate?: Date | null;

  @Column({ name: 'payment_method', type: 'varchar', length: 40, nullable: true })
  paymentMethod?: string | null;

  @Column({ name: 'payment_reference', type: 'varchar', length: 80, nullable: true })
  paymentReference?: string | null;

  @Column({ name: 'receipt_doc_ref', type: 'varchar', length: 255, nullable: true })
  receiptDocRef?: string | null;

  @Column({ name: 'receipt_data_url', type: 'longtext', nullable: true })
  receiptDataUrl?: string | null;
}
