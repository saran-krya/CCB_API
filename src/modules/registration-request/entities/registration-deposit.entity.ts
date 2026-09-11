import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { RegistrationRequest } from './registration-request.entity';
import { RegistrationDepositPaymentStatus } from './registration-request.enums';

export { RegistrationDepositPaymentStatus } from './registration-request.enums';

/**
 * Single source of truth for a registration request's security-deposit payment state — replaces
 * the four registration_requests.deposit_* columns (security_deposit_amount, deposit_payment_status,
 * deposit_payment_method, deposit_payment_reference, deposit_paid_date), which previously
 * duplicated the same information also written onto RegistrationDemand.paymentMethod/
 * paymentReference/paidDate with no FK tying the two together. RegistrationDemand remains the
 * financial-ledger record of the actual demand (subtotal/VAT/components); this table is the
 * request's own deposit-status view, one row per request, kept in sync with whichever demand it
 * corresponds to by RegistrationRequestService.
 *
 * A OneToOne is intentional (not OneToMany) — a registration request has exactly one running
 * deposit state, even though it may go through several RegistrationDemand rows over its lifecycle
 * (raised, reversed-and-re-raised on rejection, etc).
 */
@Entity('registration_deposits')
export class RegistrationDeposit extends BaseEntity {
  @OneToOne(() => RegistrationRequest, (r) => r.depositEntry, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: RegistrationRequest;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  amount!: number;

  @Column({
    type: 'enum',
    enum: RegistrationDepositPaymentStatus,
    default: RegistrationDepositPaymentStatus.PENDING,
  })
  status!: RegistrationDepositPaymentStatus;

  @Column({ name: 'payment_method', type: 'varchar', length: 40, nullable: true })
  paymentMethod?: string | null;

  @Column({ name: 'payment_reference', type: 'varchar', length: 80, nullable: true })
  paymentReference?: string | null;

  @Column({ name: 'paid_at', type: 'datetime', nullable: true })
  paidAt?: Date | null;
}
