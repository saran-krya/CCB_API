import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum RegistrationDocumentLevel {
  IDENTITY = 'Identity',
  ACCOUNT = 'Account',
  UNIT = 'Unit',
  PAYMENT = 'Payment',
}

export enum RegistrationDocumentResident {
  OWNER = 'Owner',
  TENANT = 'Tenant',
  BOTH = 'Both',
}

export enum RegistrationDocumentAccountType {
  INDIVIDUAL = 'Individual',
  CORPORATE = 'Corporate',
  BOTH = 'Both',
}

export enum RegistrationDocumentContactType {
  SELF = 'Self',
  AUTHORIZED_REPRESENTATIVE = 'Authorized Representative',
  MANAGER_ON_LICENSE = 'Manager on License',
  ANY = 'Any',
}

export enum RegistrationDocumentRequirement {
  MANDATORY = 'Mandatory',
  OPTIONAL = 'Optional',
  NOT_APPLICABLE = 'Not Applicable',
}

/**
 * System Admin -> Document Set Definition ("Registration" set) — the single source of truth for
 * which documents the registration wizard requires, per resident/account/contact-type combination.
 * See CCB Customer Management backend spec §8.3.
 */
@Entity('registration_document_rules')
@Index(['documentType', 'appliesToResident', 'appliesToAccount', 'appliesToContactType'])
export class RegistrationDocumentRule extends BaseEntity {
  @Column({ name: 'document_type', type: 'varchar', length: 60 })
  documentType!: string;

  @Column({ type: 'enum', enum: RegistrationDocumentLevel })
  level!: RegistrationDocumentLevel;

  @Column({
    name: 'applies_to_resident',
    type: 'enum',
    enum: RegistrationDocumentResident,
    default: RegistrationDocumentResident.BOTH,
  })
  appliesToResident!: RegistrationDocumentResident;

  @Column({
    name: 'applies_to_account',
    type: 'enum',
    enum: RegistrationDocumentAccountType,
    default: RegistrationDocumentAccountType.BOTH,
  })
  appliesToAccount!: RegistrationDocumentAccountType;

  @Column({
    name: 'applies_to_contact_type',
    type: 'enum',
    enum: RegistrationDocumentContactType,
    default: RegistrationDocumentContactType.ANY,
  })
  appliesToContactType!: RegistrationDocumentContactType;

  @Column({
    type: 'enum',
    enum: RegistrationDocumentRequirement,
  })
  requirement!: RegistrationDocumentRequirement;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'display_order', type: 'int', default: 1 })
  displayOrder!: number;
}
