import { Column, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Unit } from '../../unit/entities/unit.entity';

export enum ResidentType {
  OWNER = 'owner',
  TENANT = 'tenant',
}

/** The Customer ACCOUNT's own lifecycle — never conflated with the registration workflow that
 *  created it. A Customer is created INACTIVE at registration approval and flips to ACTIVE only
 *  once the customer completes their own activation (sets their password — see
 *  CustomerService.activate()). OVERDUE remains controlled entirely by existing billing/business
 *  logic elsewhere, unaffected by this. There is deliberately no separate "activation status"
 *  field — accountStatus alone carries this, one column instead of two independently-drifting
 *  ones. */
export enum CustomerAccountStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  OVERDUE = 'overdue',
}

export enum CustomerAccountType {
  INDIVIDUAL = 'Individual',
  CORPORATE = 'Corporate',
}

export enum CustomerContactType {
  SELF = 'Self',
  AUTHORIZED_REPRESENTATIVE = 'Authorized Representative',
  MANAGER_ON_LICENSE = 'Manager on License',
}

export enum CustomerLegalStructure {
  LLC = 'LLC',
  FREE_ZONE_COMPANY = 'Free Zone Company',
  SOLE_ESTABLISHMENT = 'Sole Establishment',
  BRANCH_OF_FOREIGN_COMPANY = 'Branch of Foreign Company',
}

/** Mask-only mock of what a real payment gateway tokenizes — see spec §4.1.2. Never add a raw
 *  number or CVV field. */
export interface CustomerPaymentMethod {
  id: string;
  type: string;
  maskedIdentifier: string;
  brandOrBank?: string | null;
  expiry?: string | null;
  accountHolderName?: string | null;
  bankName?: string | null;
  isDefault: boolean;
}

export interface CustomerPropertyBilling {
  propertyId: number;
  billingType: 'Consolidated' | 'Per Unit';
}

/**
 * The Owner/Tenant person master record. Company/Trade-License/TRN data lives on the sibling
 * Company entity (1:1, present only when accountType is Corporate) — see that entity's own doc
 * comment, including why Customer 1:1 Company (not shared/linked) matches verified current
 * behavior.
 */
@Entity('customers')
export class Customer extends BaseEntity {
  /** The primary/first unit — kept for backward compatibility with the existing single-unit List
   *  and Detail queries. A multi-unit customer's additional units live in `additionalUnits`. */
  @ManyToOne(() => Unit, { nullable: false })
  @JoinColumn({ name: 'unit_id' })
  unit!: Unit;

  @ManyToMany(() => Unit)
  @JoinTable({
    name: 'customer_additional_units',
    joinColumn: { name: 'customer_id' },
    inverseJoinColumn: { name: 'unit_id' },
  })
  additionalUnits!: Unit[];

  @Column({ name: 'full_name', type: 'varchar', length: 160 })
  fullName!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  salutation?: string | null;

  @Column({ name: 'first_name', type: 'varchar', length: 80, nullable: true })
  firstName?: string | null;

  @Column({ name: 'middle_name', type: 'varchar', length: 80, nullable: true })
  middleName?: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 80, nullable: true })
  lastName?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  occupation?: string | null;

  @Column({ name: 'contact_email', type: 'varchar', length: 160, nullable: true })
  contactEmail?: string | null;

  @Column({ name: 'contact_phone', type: 'varchar', length: 30, nullable: true })
  contactPhone?: string | null;

  @Column({ name: 'alternate_phone', type: 'varchar', length: 30, nullable: true })
  alternatePhone?: string | null;

  @Column({ name: 'principal_name', type: 'varchar', length: 160, nullable: true })
  principalName?: string | null;

  @Column({ name: 'principal_email', type: 'varchar', length: 160, nullable: true })
  principalEmail?: string | null;

  @Column({ name: 'principal_phone', type: 'varchar', length: 30, nullable: true })
  principalPhone?: string | null;

  @Column({ name: 'principal_is_primary_recipient', type: 'boolean', nullable: true })
  principalIsPrimaryRecipient?: boolean | null;

  @Column({ name: 'property_document_type', type: 'varchar', length: 60, nullable: true })
  propertyDocumentType?: string | null;

  @Column({ name: 'property_document_reference', type: 'varchar', length: 120, nullable: true })
  propertyDocumentReference?: string | null;

  @Column({
    name: 'account_type',
    type: 'enum',
    enum: CustomerAccountType,
    default: CustomerAccountType.INDIVIDUAL,
  })
  accountType!: CustomerAccountType;

  @Column({ name: 'contact_person_name', type: 'varchar', length: 160, nullable: true })
  contactPersonName?: string | null;

  @Column({ name: 'contact_type', type: 'enum', enum: CustomerContactType, nullable: true })
  contactType?: CustomerContactType | null;

  @Column({
    name: 'resident_type',
    type: 'enum',
    enum: ResidentType,
  })
  residentType!: ResidentType;

  /** ORIGINATED occupancy flag — Owner-only input (implicit-true for Tenants). THE occupancy gate:
   *  a unit is open to a tenant iff a registered Owner exists AND owner.isResident === false. */
  @Column({ name: 'is_resident', type: 'boolean', nullable: true })
  isResident?: boolean | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  gender?: string | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  nationality?: string | null;

  @Column({ name: 'marital_status', type: 'varchar', length: 30, nullable: true })
  maritalStatus?: string | null;

  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl?: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  mobile?: string | null;

  @Column({ name: 'preferred_communication_channel', type: 'varchar', length: 20, default: 'Email' })
  preferredCommunicationChannel!: string;

  @Column({ name: 'preferred_language', type: 'varchar', length: 20, default: 'English' })
  preferredLanguage!: string;

  @Column({ name: 'payment_methods', type: 'simple-json', nullable: true })
  paymentMethods?: CustomerPaymentMethod[] | null;

  /** The applicant's own explicit choice, captured on the Registration wizard's Payment step and
   *  carried through unchanged at approval (see RegistrationRequestService.toCreateCustomerDto) —
   *  never re-derived from the default payment method's type. Defaults false; the UI only ever
   *  offers this toggle when the default method is a Card, but that's a UI eligibility rule, not
   *  a reason to recompute the stored value from the method type after the fact. */
  @Column({ name: 'auto_pay_enabled', type: 'boolean', default: false })
  autoPayEnabled!: boolean;

  @Column({ name: 'property_billing', type: 'simple-json', nullable: true })
  propertyBilling?: CustomerPropertyBilling[] | null;

  @Column({ name: 'emergency_contact_name', type: 'varchar', length: 160, nullable: true })
  emergencyContactName?: string | null;

  @Column({ name: 'emergency_contact_phone', type: 'varchar', length: 30, nullable: true })
  emergencyContactPhone?: string | null;

  /** FK to the RegistrationDemand this onboarding cleared, for a future move-out refund. Typed as
   *  a bare int (not a relation) to avoid a circular import between the customer and
   *  registration-request modules — see spec §4.1.1. */
  @Column({ name: 'registration_demand_id', type: 'int', nullable: true })
  registrationDemandId?: number | null;

  /** Default ACTIVE is this column's own fallback for the standalone `POST /customers` creation
   *  path (not part of the registration/activation flow). The registration-approval path
   *  (RegistrationRequestService.toCreateCustomerDto()) explicitly overrides this to INACTIVE —
   *  see that method's own doc comment for why. */
  @Column({
    name: 'account_status',
    type: 'enum',
    enum: CustomerAccountStatus,
    default: CustomerAccountStatus.ACTIVE,
  })
  accountStatus!: CustomerAccountStatus;

  @Column({ name: 'security_deposit', type: 'decimal', precision: 12, scale: 2, nullable: true })
  securityDeposit?: number | null;

  @Column({ name: 'registered_date', type: 'date', nullable: true })
  registeredDate?: string | null;

  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  /** Set only once the customer completes their own activation link (see CustomerActivationToken) —
   *  never written by staff. Nullable: null means the customer has not yet set a password. Setting
   *  it is also what flips `accountStatus` from INACTIVE to ACTIVE (see
   *  CustomerService.activate()) — no login is possible until then, since customer-facing
   *  authentication is a follow-up subsystem and this column is groundwork for that, not a login
   *  mechanism in itself. Same bcryptjs/12-rounds convention as User.passwordHash (see
   *  UserService), and `select: false` for the same reason. */
  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash?: string | null;
}
