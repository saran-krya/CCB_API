import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Property } from '../../property/entities/property.entity';

@Entity('communities')
export class Community extends BaseEntity {
  @Column({
    type: 'varchar',
    length: 160,
  })
  name!: string;

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
  })
  code!: string;

  @Column({
    type: 'boolean',
    default: true,
  })
  status!: boolean;

  @OneToMany(() => Property, (property) => property.community)
  properties!: Property[];
}