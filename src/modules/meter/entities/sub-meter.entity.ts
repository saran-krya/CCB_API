import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Property } from '../../property/entities/property.entity';
import { Unit } from '../../unit/entities/unit.entity';
import { User } from '../../user/entities/user.entity';
import { MasterMeter } from './master-meter.entity';
import { MeterStatus } from './meter-status.enum';

@Entity('sub_meters')
export class SubMeter extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

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
  // the actual mapping operation — mirrors the legacy Unit.subMeterId /
  // Unit.masterMeterId denormalized fields, which are kept in sync by
  // MeterService whenever a sub-meter's unit link changes.
  @ManyToOne(() => Unit, { nullable: true })
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
