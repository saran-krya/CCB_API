import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Property } from '../../property/entities/property.entity';
import { User } from '../../user/entities/user.entity';
import { MeterReading } from '../../sftp/entities/meter-reading.entity';

// A real field-visit request for a property, raised against one or more specific anomalous
// MeterReading rows. Once a reading is included in a request here, the frontend treats it as
// "locked" (already covered by an in-flight request) — the same behavior the Template's mock
// service (`updateInspectionStatus`) implemented in-memory, now real and persisted. Status is
// intentionally a single real state today (REQUESTED) — this feature has no approve/reject/resolve
// workflow of its own yet; it exists to notify/assign a field visit, not to be a second parallel
// approval pipeline alongside Bill Run's. Extending it with real intermediate states is a future
// change, not something to invent here without a corresponding UI to act on them.
export enum FieldInspectionRequestStatus {
  REQUESTED = 'requested',
}

@Entity('field_inspection_requests')
@Index('IDX_field_inspection_requests_property', ['propertyId'])
export class FieldInspectionRequest extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  @ManyToOne(() => Property, { nullable: false })
  @JoinColumn({ name: 'property_id' })
  property!: Property;

  @Column({ name: 'property_id' })
  propertyId!: number;

  // Free-text LOV codes (category FIELD_INSPECTION_TYPE / FIELD_INSPECTION_PRIORITY), not FKs to
  // lov_values — matches how BillingCycle/Tariff reason fields already store an LOV code as a plain
  // string column rather than a join, since the option set is small, admin-editable, and never
  // needs its own relational integrity beyond "is this a currently-valid code" (checked at the
  // service layer against LovService.findByCategory, same as every other LOV-driven text field in
  // this codebase).
  @Column({ name: 'inspection_type', type: 'varchar', length: 100 })
  inspectionType!: string;

  @Column({ name: 'priority', type: 'varchar', length: 50 })
  priority!: string;

  @Column({ name: 'description', type: 'text' })
  description!: string;

  @Column({ name: 'inspection_date', type: 'date' })
  inspectionDate!: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'assigned_to_user_id' })
  assignedTo!: User;

  @Column({ name: 'assigned_to_user_id' })
  assignedToUserId!: number;

  // Simple JSON array of LOV codes (category FIELD_INSPECTION_NOTIFY_ROLE) — a multi-select with no
  // need for its own join table, same reasoning as inspectionType/priority above.
  @Column({ name: 'notify', type: 'json' })
  notify!: string[];

  @Column({ name: 'resolution_by', type: 'date' })
  resolutionBy!: string;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: FieldInspectionRequestStatus,
    default: FieldInspectionRequestStatus.REQUESTED,
  })
  status!: FieldInspectionRequestStatus;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'requested_by_id' })
  requestedBy?: User | null;

  @Column({ name: 'requested_by_id', nullable: true })
  requestedById?: number | null;

  @Column({ name: 'requested_on', type: 'datetime' })
  requestedOn!: Date;

  // Every MeterReading this request covers. A reading can appear in more than one request over
  // time in principle (TypeORM relation allows it), but the service layer excludes any reading
  // already covered by an existing request from being selectable again — see
  // FieldInspectionService.getSelectableReadings's own doc comment.
  @ManyToMany(() => MeterReading)
  @JoinTable({
    name: 'field_inspection_request_readings',
    joinColumn: { name: 'field_inspection_request_id' },
    inverseJoinColumn: { name: 'meter_reading_id' },
  })
  readings!: MeterReading[];
}
