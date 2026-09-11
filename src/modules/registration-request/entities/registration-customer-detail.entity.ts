import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { RegistrationRequest } from './registration-request.entity';
import { RegistrationContactType } from './registration-request.enums';

/**
 * The applicant/customer information captured during a registration request — person identity,
 * principal/representative, and account contact. Kept separate from RegistrationRequest itself so
 * that table stays focused on application/workflow state (spec: "registration_requests should be
 * the MAIN registration/application table"). Company/Trade-License/TRN fields live on the sibling
 * RegistrationCompanyDetail (1:1, present only for Corporate requests) — see that entity's own doc
 * comment.
 *
 * This is NOT the Customer entity — RegistrationCustomerDetail is a point-in-time snapshot of what
 * the applicant entered on THIS request; Customer is the actual active customer/master record
 * created once at approval (RegistrationRequestService.toCreateCustomerDto). The two are never
 * synced after the fact and this table is never written back into Customer beyond that one-time
 * copy, matching how selectedUnits/paymentMethods/propertyBilling already behave.
 *
 * A OneToOne is intentional — every registration request has exactly one customer-detail row,
 * created alongside the request itself (see RegistrationRequestService.createDraft).
 *
 * contactPersonName/contactType identify the natural person Passport/Emirates ID documents belong
 * to — including for a Corporate request, where contactType is constrained to "Manager on License"
 * or "Authorized Representative" (never "Self"; see useRegistrationCreation.ts's contactTypeOptions)
 * since a company cannot itself be the applicant. KYC documents never belong to
 * RegistrationCompanyDetail.
 */
@Entity('registration_customer_details')
export class RegistrationCustomerDetail extends BaseEntity {
  @OneToOne(() => RegistrationRequest, (r) => r.customerDetails, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'registration_request_id' })
  request!: RegistrationRequest;

  // ── Person / identity ────────────────────────────────────────────────────────────────────────
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

  @Column({ name: 'alternate_phone', type: 'varchar', length: 30, nullable: true })
  alternatePhone?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  gender?: string | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  nationality?: string | null;

  @Column({ name: 'marital_status', type: 'varchar', length: 30, nullable: true })
  maritalStatus?: string | null;

  // ── Represented owner/tenant block (Individual + Authorized Representative) ─────────────────────
  @Column({ name: 'principal_name', type: 'varchar', length: 160, nullable: true })
  principalName?: string | null;

  @Column({ name: 'principal_email', type: 'varchar', length: 160, nullable: true })
  principalEmail?: string | null;

  @Column({ name: 'principal_phone', type: 'varchar', length: 30, nullable: true })
  principalPhone?: string | null;

  @Column({ name: 'principal_is_primary_recipient', type: 'boolean', nullable: true })
  principalIsPrimaryRecipient?: boolean | null;

  // ── Account contact ───────────────────────────────────────────────────────────────────────────
  @Column({ name: 'contact_person_name', type: 'varchar', length: 160, nullable: true })
  contactPersonName?: string | null;

  @Column({ name: 'contact_type', type: 'enum', enum: RegistrationContactType, nullable: true })
  contactType?: RegistrationContactType | null;

  // Nullable — a Draft is deliberately allowed to be sparse. Required before the request can leave
  // Draft; enforced in RegistrationRequestService.submitForReview (via assertSubmissionComplete),
  // not at the column level, since the applicant's own email/mobile may only be captured once the
  // identity document is verified.
  @Column({ type: 'varchar', length: 160, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  mobile?: string | null;

  @Column({ name: 'emergency_contact_name', type: 'varchar', length: 160, nullable: true })
  emergencyContactName?: string | null;

  @Column({ name: 'emergency_contact_phone', type: 'varchar', length: 30, nullable: true })
  emergencyContactPhone?: string | null;

  @Column({ name: 'emergency_contact_relationship', type: 'varchar', length: 40, nullable: true })
  emergencyContactRelationship?: string | null;

  @Column({ name: 'preferred_language', type: 'varchar', length: 20, default: 'English' })
  preferredLanguage!: string;

  @Column({ name: 'preferred_communication_channel', type: 'varchar', length: 20, default: 'Email' })
  preferredCommunicationChannel!: string;

  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl?: string | null;

  // ── Account-level property document mirror ───────────────────────────────────────────────────
  @Column({ name: 'property_document_type', type: 'varchar', length: 60, nullable: true })
  propertyDocumentType?: string | null;

  @Column({ name: 'property_document_reference', type: 'varchar', length: 120, nullable: true })
  propertyDocumentReference?: string | null;
}
