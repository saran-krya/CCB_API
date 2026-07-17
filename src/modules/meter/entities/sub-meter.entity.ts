import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Property } from '../../property/entities/property.entity';
import { Unit } from '../../unit/entities/unit.entity';
import { User } from '../../user/entities/user.entity';
import { MasterMeter } from './master-meter.entity';
import { MeterStatus } from './meter-status.enum';

// M-Bus addresses are only meaningful within one wired bus segment — the
// Master Meter is the segment a Sub Meter's M-Bus address is scoped to, so
// the same address value legitimately repeats across different Master
// Meters. Unique per Master Meter, not globally (confirmed with the
// business owner — see the Meter Import enterprise audit).
//
// Named explicitly — see the matching comment on MasterMeter's own
// composite index for why. A dedicated plain index on `master_meter_id`
// alone (added by MeterUniquenessMigrationService) backs
// FK_d4dfcff9f167345902b3633d38d independently, so this composite index is
// never load-bearing for that foreign key and can be freely dropped/
// recreated by `synchronize` without MySQL refusing the operation.
@Entity('sub_meters')
@Index('UQ_sub_meters_master_meter_mbus', ['masterMeter', 'mBusAddress'], { unique: true })
// serialNumber is named explicitly — see the matching comment above and on
// MasterMeter's own indexes for why (avoids @Column({ unique: true })'s
// auto-generated name, which doesn't match what
// MeterUniquenessMigrationService already created via raw SQL).
@Index('UQ_sub_meters_serial_number', ['serialNumber'], { unique: true })
export class SubMeter extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  // A physical meter's nameplate serial number — globally unique across the
  // whole portfolio (confirmed with the business owner). Uniqueness is
  // declared via the named @Index above, not this column's own `unique`
  // option — see that comment for why.
  @Column({ name: 'serial_number', type: 'varchar', length: 100, nullable: true })
  serialNumber?: string | null;

  @ManyToOne(() => MasterMeter, (masterMeter) => masterMeter.subMeters, { nullable: false })
  @JoinColumn({ name: 'master_meter_id' })
  masterMeter!: MasterMeter;

  @ManyToOne(() => Property, { nullable: false })
  @JoinColumn({ name: 'property_id' })
  property!: Property;

  // Nullable = the sub-meter is installed but not yet linked to a billable
  // unit ("Unmapped" in the Meter Information UI). Setting/clearing this is
  // the actual mapping operation — the ONLY place a unit's meter mapping is
  // stored (Unit.subMeter is the read-only inverse side of this relation).
  // One-to-one: a unit has at most one sub-meter, enforced at the DB layer
  // by a unique index on sub_meters.unit_id (see MeterUniquenessMigrationService).
  @OneToOne(() => Unit, { nullable: true })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit | null;

  @Column({ name: 'm_bus_address', type: 'varchar', length: 100, nullable: true })
  mBusAddress?: string | null;

  @Column({ type: 'enum', enum: MeterStatus, default: MeterStatus.ACTIVE })
  status!: MeterStatus;

  @Column({ type: 'smallint', nullable: true })
  floor?: number | null;

  @Column({ name: 'meter_make', type: 'varchar', length: 100, nullable: true })
  meterMake?: string | null;

  @Column({ name: 'meter_model', type: 'varchar', length: 100, nullable: true })
  meterModel?: string | null;

  @Column({ name: 'installation_date', type: 'date', nullable: true })
  installationDate?: string | null;

  @Column({ name: 'customer_account_number', type: 'varchar', length: 100, nullable: true })
  customerAccountNumber?: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdByUser?: User | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'last_modified_by_id' })
  lastModifiedByUser?: User | null;
}
