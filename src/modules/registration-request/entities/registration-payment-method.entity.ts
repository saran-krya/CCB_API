import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { RegistrationRequest } from './registration-request.entity';

/**
 * Mask-only mock of what a real payment gateway tokenizes. The raw card/account number is NEVER
 * stored and there is NO cvv column — see RegistrationRequest's former PaymentMethod interface
 * doc, carried forward here. "Exactly one isDefault per request" is enforced in
 * RegistrationRequestService (transactional check-and-set on add/update), not a DB constraint —
 * MySQL has no native partial-unique-index equivalent to express it declaratively. Replaces the
 * old registration_requests.payment_methods simple-json column.
 */
@Entity('registration_payment_methods')
export class RegistrationPaymentMethod extends BaseEntity {
  @ManyToOne(() => RegistrationRequest, (r) => r.paymentMethodEntries, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: RegistrationRequest;

  @Column({ type: 'varchar', length: 40 })
  type!: string;

  @Column({ name: 'masked_identifier', type: 'varchar', length: 40 })
  maskedIdentifier!: string;

  @Column({ name: 'brand_or_bank', type: 'varchar', length: 80, nullable: true })
  brandOrBank?: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  expiry?: string | null;

  @Column({ name: 'account_holder_name', type: 'varchar', length: 160, nullable: true })
  accountHolderName?: string | null;

  @Column({ name: 'bank_name', type: 'varchar', length: 160, nullable: true })
  bankName?: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;
}
