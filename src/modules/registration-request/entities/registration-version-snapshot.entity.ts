import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { RegistrationRequest } from './registration-request.entity';

/**
 * Forward-compatible groundwork (spec §4.2.4) — one snapshot per correction-triggering edit, plus a
 * baseline '0.1' at creation. `changedFields` is honestly `[]` until a real resubmission/edit flow
 * exists to report an actual diff into; never fabricate a value here.
 */
@Entity('registration_version_snapshots')
export class RegistrationVersionSnapshot extends BaseEntity {
  @ManyToOne(() => RegistrationRequest, (r) => r.versions, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: RegistrationRequest;

  @Column({ name: 'version_number', type: 'varchar', length: 10 })
  versionNumber!: string;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({ name: 'event', type: 'varchar', length: 120 })
  event!: string;

  @Column({ name: 'changed_fields', type: 'simple-json', nullable: true })
  changedFields?: string[] | null;
}
