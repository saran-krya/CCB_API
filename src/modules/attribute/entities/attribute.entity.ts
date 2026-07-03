import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum AttributeScope {
  SYSTEM = 'system',
  MODULE = 'module',
}

export enum AttributeValueType {
  BOOLEAN = 'boolean',
  NUMBER = 'number',
  TEXT = 'text',
}

@Entity('attributes')
export class Attribute extends BaseEntity {
  @Column({ type: 'enum', enum: AttributeScope })
  scope!: AttributeScope;

  @Column({ type: 'varchar', length: 50, nullable: true })
  module!: string | null;

  @Column({ name: 'group_key', type: 'varchar', length: 100, nullable: true })
  groupKey!: string | null;

  @Column({ name: 'group_label', type: 'varchar', length: 150, nullable: true })
  groupLabel!: string | null;

  @Column({ name: 'group_description', type: 'varchar', length: 255, nullable: true })
  groupDescription!: string | null;

  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'varchar', length: 150 })
  label!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({ name: 'value_type', type: 'enum', enum: AttributeValueType })
  valueType!: AttributeValueType;

  @Column({ type: 'text' })
  value!: string;

  @Column({ name: 'true_label', type: 'varchar', length: 100, nullable: true })
  trueLabel!: string | null;

  @Column({ name: 'false_label', type: 'varchar', length: 100, nullable: true })
  falseLabel!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  unit!: string | null;

  @Column({ type: 'boolean', default: true })
  editable!: boolean;

  @Column({ name: 'is_system_defined', type: 'boolean', default: true })
  isSystemDefined!: boolean;

  @Column({ name: 'display_order', type: 'int', default: 1 })
  displayOrder!: number;
}
