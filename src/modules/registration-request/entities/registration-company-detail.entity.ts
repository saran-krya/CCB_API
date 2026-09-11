import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { RegistrationRequest } from './registration-request.entity';
import { RegistrationLegalStructure } from './registration-request.enums';

/**
 * The Company/Trade-License/TRN data captured during a Corporate registration request — split out
 * of RegistrationCustomerDetail (which now holds Owner/Tenant person fields only). A row exists
 * ONLY when the request's accountType is Corporate; an Individual request has no
 * RegistrationCompanyDetail row at all (row-absence models the optionality, not a nullable FK —
 * same convention already used by RegistrationDeposit).
 *
 * This is NOT the Company entity — RegistrationCompanyDetail is a point-in-time snapshot of what
 * the applicant entered on THIS request; Company is the actual active company/master record
 * created once at approval (RegistrationRequestService.toCreateCompanyDto). The two are never
 * synced after the fact, matching how RegistrationCustomerDetail/Customer already behave.
 *
 * Passport/Emirates ID remain owned by the person in RegistrationCustomerDetail.contactPersonName
 * (role: contactType) — a company cannot hold KYC identity documents, even when Corporate. See
 * RegistrationCustomerDetail's own contactType/contactPersonName fields.
 */
@Entity('registration_company_details')
export class RegistrationCompanyDetail extends BaseEntity {
  @OneToOne(() => RegistrationRequest, (r) => r.companyDetail, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'registration_request_id' })
  request!: RegistrationRequest;

  @Column({ name: 'legal_structure', type: 'enum', enum: RegistrationLegalStructure, nullable: true })
  legalStructure?: RegistrationLegalStructure | null;

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
