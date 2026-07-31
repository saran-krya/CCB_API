import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

@Entity('lov_values')
@Index(['category', 'code'], { unique: true })
export class LovValue extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  category!: string;

  @Column({ type: 'varchar', length: 100 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'direction', type: 'varchar', length: 3, nullable: true })
  direction?: string | null; 

  @Column({ name: 'locale_code', type: 'varchar', length: 20, nullable: true })
  localeCode?: string | null; 

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;
}
