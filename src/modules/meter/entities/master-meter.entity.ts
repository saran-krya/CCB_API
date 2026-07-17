import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Property } from '../../property/entities/property.entity';
import { User } from '../../user/entities/user.entity';
import { MeterStatus } from './meter-status.enum';
import { SubMeter } from './sub-meter.entity';

// M-Bus addresses are only meaningful within one wired bus segment — each
// Property is its own segment for its Master Meter, so the same address
// value legitimately repeats across different Properties. Unique per
// Property, not globally (confirmed with the business owner — see the
// Meter Import enterprise audit).
//
// Named explicitly (not left to TypeORM's auto-generated hash name) so it
// matches exactly what MeterUniquenessMigrationService creates via raw SQL
// on already-initialized databases — `synchronize: true` (dev only) does a
// live schema diff by index name, and a name mismatch here made it try to
// drop-and-recreate this index on every boot, which MySQL refused because
// FK_d4dfcff9f167345902b3633d38d (sub_meters.master_meter_id) depended on
// its Master Meter counterpart's equivalent at the time. The dedicated
// UNIQUE index on `property_id` alone declared just below (added by the
// same migration service) now backs that Property FK independently, so
// this composite index is never load-bearing for a foreign key and can be
// freely dropped/recreated.
@Entity('master_meters')
@Index('UQ_master_meters_property_mbus', ['property', 'mBusAddress'], { unique: true })
// serialNumber/dtuId are named explicitly (see the composite-index comment
// above for why) rather than using @Column({ unique: true })'s shorthand,
// which would generate yet another TypeORM-computed name that doesn't match
// what MeterUniquenessMigrationService already created via raw SQL.
@Index('UQ_master_meters_serial_number', ['serialNumber'], { unique: true })
@Index('UQ_master_meters_dtu_id', ['dtuId'], { unique: true })
// One Master Meter per Property (one-to-one) — mirrors
// UQ_sub_meters_unit_id's role for Unit -> Sub Meter. Previously enforced
// only in MeterService.importMeters() against a pre-import snapshot, which
// a concurrent import (or import racing a direct create call) could still
// slip past; this closes that race at the DB layer. Also supersedes the
// migration service's old plain index on `property_id` alone — see
// MeterUniquenessMigrationService's SUPERSEDED_INDEXES comment.
@Index('UQ_master_meters_property_id', ['property'], { unique: true })
export class MasterMeter extends BaseEntity {
  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;

  // A physical meter's nameplate serial number — globally unique across the
  // whole portfolio (confirmed with the business owner). Uniqueness is
  // declared via the named @Index above, not this column's own `unique`
  // option — see that comment for why.
  @Column({ name: 'serial_number', type: 'varchar', length: 100, nullable: true })
  serialNumber?: string | null;

  // The tower's physical Data Transfer Unit — one DTU per tower/property,
  // and the DTU hardware ID itself is globally unique across the whole
  // portfolio (confirmed with the business owner). Uniqueness declared via
  // the named @Index above — see that comment for why.
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
