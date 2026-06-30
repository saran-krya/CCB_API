import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('audit_logs')
export class AuditLog extends BaseEntity {
  @Column({
    name: 'module_name',
    type: 'varchar',
    length: 120,
  })
  moduleName!: string;

  @Column({
    name: 'entity_id',
    type: 'int',
    nullable: true,
  })
  entityId?: number | null;

  @Column({
    type: 'varchar',
    length: 80,
  })
  action!: string;

  @Column({
    name: 'old_value',
    type: 'text',
    nullable: true,
  })
  oldValue?: string | null;

  @Column({
    name: 'new_value',
    type: 'text',
    nullable: true,
  })
  newValue?: string | null;

  @Column({
    name: 'performed_by',
    type: 'int',
    nullable: true,
  })
  performedBy?: number | null;
}