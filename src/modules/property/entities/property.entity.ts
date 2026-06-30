import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Community } from '../../community/entities/community.entity';
import { Unit } from '../../unit/entities/unit.entity';

export enum PropertyStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum PropertyType {
  RESIDENTIAL = 'residential',
  COMMERCIAL = 'commercial',
  MIXED = 'mixed',
}

@Entity('properties')
export class Property extends BaseEntity {
  @ManyToOne(() => Community, (community) => community.properties, { nullable: false })
  @JoinColumn({ name: 'community_id' })
  community!: Community;

  @Column({ name: 'property_name', type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'property_code', type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({
    name: 'property_type',
    type: 'enum',
    enum: PropertyType,
    default: PropertyType.RESIDENTIAL,
  })
  propertyType!: PropertyType;

  @Column({ name: 'number_of_floors', type: 'smallint', default: 1 })
  numberOfFloors!: number;

  @Column({
    name: 'property_status',
    type: 'enum',
    enum: PropertyStatus,
    default: PropertyStatus.ACTIVE,
  })
  status!: PropertyStatus;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state?: string | null;

  @Column({ name: 'zip_code', type: 'varchar', length: 20, nullable: true })
  zipCode?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country?: string | null;

  @Column({ name: 'contact_person', type: 'varchar', length: 160, nullable: true })
  contactPerson?: string | null;

  @Column({ name: 'contact_email', type: 'varchar', length: 160, nullable: true })
  contactEmail?: string | null;

  @Column({ name: 'contact_phone', type: 'varchar', length: 30, nullable: true })
  contactPhone?: string | null;

  @OneToMany(() => Unit, (unit) => unit.property)
  units!: Unit[];
}
