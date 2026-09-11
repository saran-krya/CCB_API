import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { RegistrationRequest } from './registration-request.entity';

export enum RegistrationDocumentStatus {
  VALID = 'Valid',
  EXPIRING_SOON = 'Expiring Soon',
  EXPIRED = 'Expired',
  MISSING = 'Missing',
}

/** One extracted field on a document, per spec §4.2.2 / §9. Not queried independently — lives as
 *  JSON on the owning document row. */
export interface RegistrationDocumentExtractedField {
  fieldName: string;
  extractedValue: string | null;
  confidence: number | null;
  verified: boolean;
}

@Entity('registration_documents')
export class RegistrationDocument extends BaseEntity {
  @ManyToOne(() => RegistrationRequest, (r) => r.documents, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: RegistrationRequest;

  @Column({ type: 'varchar', length: 60 })
  type!: string;

  @Column({
    type: 'enum',
    enum: RegistrationDocumentStatus,
    default: RegistrationDocumentStatus.MISSING,
  })
  status!: RegistrationDocumentStatus;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate?: string | null;

  @Column({ name: 'uploaded_date', type: 'date', nullable: true })
  uploadedDate?: string | null;

  /** STUB reference — no real file storage yet (spec §11). */
  @Column({ name: 'file_ref', type: 'varchar', length: 255, nullable: true })
  fileRef?: string | null;

  /** SESSION-adjacent stub: real uploads should go to object storage; this column is a temporary
   *  bridge until that lands (spec §11) — kept nullable/TEXT so it never blocks a request. */
  @Column({ name: 'file_data', type: 'longtext', nullable: true })
  fileData?: string | null;

  @Column({ name: 'unit_id', type: 'int', nullable: true })
  unitId?: number | null;

  @Column({ name: 'extracted_fields', type: 'simple-json', nullable: true })
  extractedFields?: RegistrationDocumentExtractedField[] | null;
}
