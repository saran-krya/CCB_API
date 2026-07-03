import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

@Entity('lov_categories')
export class LovCategory extends BaseEntity {
  @Column({ type: 'varchar', length: 100, unique: true })
  category!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  module!: string | null;
}
