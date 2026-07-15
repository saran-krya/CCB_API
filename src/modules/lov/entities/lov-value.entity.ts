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

  // Only meaningful for the LANGUAGE category — null for every other
  // category's rows. General-purpose columns on the shared LOV shape rather
  // than a separate Language-specific table, consistent with how every
  // other lookup category reuses this same entity.
  @Column({ name: 'direction', type: 'varchar', length: 3, nullable: true })
  direction?: string | null; // 'ltr' | 'rtl'

  @Column({ name: 'locale_code', type: 'varchar', length: 20, nullable: true })
  localeCode?: string | null; // e.g. 'en-US'

  // System-defined rows (currently: the seeded LANGUAGE values en/ar) are
  // read-only in the admin UI — code/label/direction/localeCode cannot be
  // edited, matching CCB_Template's locked-value pattern. Data-driven, not a
  // hardcoded category check, so any future category can mark specific rows
  // system-locked the same way.
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;
}
