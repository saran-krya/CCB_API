import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Property } from '../../property/entities/property.entity';
import { User } from '../../user/entities/user.entity';
import { MeterStatus } from './meter-status.enum';
import { SubMeter } from './sub-meter.entity';

@Entity('master_meters')
export class MasterMeter extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  @Column({ name: 'serial_number', type: 'varchar', length: 100, nullable: true })
  serialNumber?: string | null;

  // The tower's physical Data Transfer Unit — one DTU per tower/property.
  @Column({ name: 'dtu_id', type: 'varchar', length: 100, nullable: true })
  dtuId?: string | null;

  @ManyToOne(() => Property, { nullable: false })
  @JoinColumn({ name: 'property_id' })
  property!: Property;

  @Column({ name: 'm_bus_address', type: 'varchar', length: 100, nullable: true })
  mBusAddress?: string | null;

  @Column({ type: 'enum', enum: MeterStatus, default: MeterStatus.ACTIVE })
  status!: MeterStatus;

  @Column({ name: 'meter_make', type: 'varchar', length: 100, nullable: true })
  meterMake?: string | null;

  @Column({ name: 'meter_model', type: 'varchar', length: 100, nullable: true })
  meterModel?: string | null;

  @Column({ name: 'installation_date', type: 'date', nullable: true })
  installationDate?: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdByUser?: User | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'last_modified_by_id' })
  lastModifiedByUser?: User | null;

  @OneToMany(() => SubMeter, (subMeter) => subMeter.masterMeter)
  subMeters!: SubMeter[];
}
