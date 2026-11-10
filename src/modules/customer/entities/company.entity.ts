import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Customer, CustomerLegalStructure } from './customer.entity';

/**
 * The Company/Trade-License/TRN master record for a Corporate Customer — split out of Customer
 * (which now holds Owner/Tenant person fields only). A row exists ONLY when the customer's
 * accountType is Corporate; an Individual customer has no Company row at all (row-absence models
 * the optionality, not a nullable FK — same convention as RegistrationCompanyDetail).
 *
 * Verified Customer 1:1 Company: today, each Customer independently owns its own Trade License/TRN
 * data with zero uniqueness/dedup check across customers (CustomerService.createWithManager's own
 * uniqueness guard is scoped to {unit, residentType} only — never tradeLicenseNumber/trn). A single
 * real-world company registering multiple units still produces one independent Company row per
 * Customer, exactly matching current behavior — this entity does not introduce company sharing,
 * linking, or deduplication.
 *
 * Populated once, at approval, by RegistrationRequestService.toCreateCompanyDto — never synced
 * afterward, matching how Customer itself is populated from RegistrationCustomerDetail. No FK back
 * to RegistrationCompanyDetail, so Company never permanently depends on the originating
 * RegistrationRequest.
 *
 * Company documents (Trade License/TRN Certificate) are NOT duplicated onto a separate table —
 * they remain RegistrationDocument rows on the customer's originating RegistrationRequest, reached
 * the same way GET /me/documents already reaches Passport/Emirates ID documents (reverse lookup via
 * CustomerPortalService.getMyOriginRequest). See RegistrationDocument's own doc comment.
 */
@Entity('company')
export class Company extends BaseEntity {
  @OneToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'legal_structure', type: 'enum', enum: CustomerLegalStructure, nullable: true })
  legalStructure?: CustomerLegalStructure | null;

  @Column({ name: 'company_registration_date', type: 'date', nullable: true })
  companyRegistrationDate?: string | null;

  @Column({ name: 'company_registration_number', type: 'varchar', length: 60, nullable: true })
  companyRegistrationNumber?: string | null;

  @Column({ name: 'trade_license_number', type: 'varchar', length: 60, nullable: true })
  tradeLicenseNumber?: string | null;

  @Column({ name: 'license_expiry_date', type: 'date', nullable: true })
  licenseExpiryDate?: string | null;

  @Column({ name: 'manager_name', type: 'varchar', length: 160, nullable: true })
  managerName?: string | null;

  @Column({ name: 'trade_license_verified', type: 'boolean', nullable: true })
  tradeLicenseVerified?: boolean | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  trn?: string | null;

  @Column({ name: 'trn_expiry_date', type: 'date', nullable: true })
  trnExpiryDate?: string | null;

  @Column({ name: 'taxable_entity_name', type: 'varchar', length: 160, nullable: true })
  taxableEntityName?: string | null;

  @Column({ name: 'effective_registration_date', type: 'date', nullable: true })
  effectiveRegistrationDate?: string | null;

  @Column({ name: 'issuing_authority', type: 'varchar', length: 120, nullable: true })
  issuingAuthority?: string | null;

  @Column({ name: 'trn_verified', type: 'boolean', nullable: true })
  trnVerified?: boolean | null;
}
