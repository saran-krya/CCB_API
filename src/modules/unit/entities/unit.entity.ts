import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Property } from '../../property/entities/property.entity';
import { SubMeter } from '../../meter/entities/sub-meter.entity';

export enum UnitType {
  APARTMENT = 'apartment',
  STUDIO = 'studio',
  OFFICE = 'office',
  SHOP = 'shop',
  GARAGE = 'garage',
}

export enum OccupancyStatus {
  OCCUPIED = 'occupied',
  VACANT = 'vacant',
}

export enum UnitStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('units')
export class Unit extends BaseEntity {
  @ManyToOne(() => Property, (property) => property.units, { nullable: false })
  @JoinColumn({ name: 'property_id' })
  property!: Property;

  @Column({ name: 'unit_number', type: 'varchar', length: 50 })
  unitNumber!: string;

  @Column({ name: 'floor_number', type: 'smallint' })
  floorNumber!: number;

  @Column({
    name: 'unit_type',
    type: 'enum',
    enum: UnitType,
  })
  unitType!: UnitType;

  @Column({ name: 'unit_size', type: 'decimal', precision: 10, scale: 2, nullable: true })
  unitSize?: number | null;

  @Column({
    name: 'occupancy_status',
    type: 'enum',
    enum: OccupancyStatus,
    default: OccupancyStatus.VACANT,
  })
  occupancyStatus!: OccupancyStatus;

  @Column({
    name: 'unit_status',
    type: 'enum',
    enum: UnitStatus,
    default: UnitStatus.ACTIVE,
  })
  status!: UnitStatus;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  bedrooms?: number | null;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  bathrooms?: number | null;

  @Column({ type: 'boolean', default: false })
  balcony!: boolean;

  @Column({ name: 'parking_spaces', type: 'tinyint', unsigned: true, default: 0 })
  parkingSpaces!: number;

  @Column({ name: 'monthly_rent', type: 'decimal', precision: 12, scale: 2, nullable: true })
  monthlyRent?: number | null;

  @Column({ name: 'handover_date', type: 'date', nullable: true })
  handoverDate?: string | null;

  @Column({ name: 'owner_id', type: 'varchar', length: 50, nullable: true })
  ownerId?: string | null;

  @Column({ name: 'tenant_id', type: 'varchar', length: 50, nullable: true })
  tenantId?: string | null;

  
  @OneToOne(() => SubMeter, (subMeter) => subMeter.unit)
  subMeter?: SubMeter | null;

  @Column({ type: 'simple-json', nullable: true })
  amenities?: string[] | null;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ name: 'business_code', type: 'varchar', length: 20, unique: true, nullable: true })
  businessCode?: string | null;
}
