import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { RegistrationRequest } from './registration-request.entity';

/**
 * Per-property consolidated-billing intent. INTENT/DISPLAY only — not read anywhere in the
 * approval/deposit flow (see RegistrationRequestService). billingType is LOV-driven
 * (category BILLING_TYPE) rather than a fixed enum, since it's a configurable business value, not
 * workflow state. Replaces the old registration_requests.property_billing simple-json column.
 */
@Entity('registration_request_property_billing')
@Unique(['request', 'propertyId'])
export class RegistrationRequestPropertyBilling extends BaseEntity {
  @ManyToOne(() => RegistrationRequest, (r) => r.propertyBillingEntries, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: RegistrationRequest;

  @Column({ name: 'property_id', type: 'int' })
  propertyId!: number;

  @Column({ name: 'billing_type', type: 'varchar', length: 40 })
  billingType!: string;
}
