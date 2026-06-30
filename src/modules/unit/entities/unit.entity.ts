import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Property } from '../../property/entities/property.entity';

@Entity('units')
export class Unit extends BaseEntity {
  @ManyToOne(() => Property, (property) => property.units, {
    nullable: false,
  })
  @JoinColumn({ name: 'property_id' })
  property!: Property;

  @Column({
    name: 'unit_no',
    type: 'varchar',
    length: 60,
  })
  unitNo!: string;

  @Column({
    name: 'unit_type',
    type: 'varchar',
    length: 80,
  })
  unitType!: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  area!: string;

  @Column({
    name: 'occupancy_type',
    type: 'varchar',
    length: 80,
  })
  occupancyType!: string;

  @Column({
    type: 'boolean',
    default: true,
  })
  status!: boolean;
}