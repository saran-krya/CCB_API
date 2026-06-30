import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Community } from '../../community/entities/community.entity';
import { Unit } from '../../unit/entities/unit.entity';

@Entity('properties')
export class Property extends BaseEntity {
  @ManyToOne(() => Community, (community) => community.properties, {
    nullable: false,
  })
  @JoinColumn({ name: 'community_id' })
  community!: Community;

  @Column({
    name: 'property_name',
    type: 'varchar',
    length: 160,
  })
  propertyName!: string;

  @Column({
    name: 'property_code',
    type: 'varchar',
    length: 50,
    unique: true,
  })
  propertyCode!: string;

  @Column({
    type: 'boolean',
    default: true,
  })
  status!: boolean;

  @OneToMany(() => Unit, (unit) => unit.property)
  units!: Unit[];
}