import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('audit_logs')
@Index(['moduleName', 'entityId', 'createdAt'])
export class AuditLog extends BaseEntity {
  // The acting user's organization AT THE TIME of the action — a snapshot, same philosophy as
  // RegistrationRequest's own snapshot columns: never updated retroactively if the actor's own
  // organization later changes, so an old audit row always reflects what was true when it was
  // written. NULL for a platform-level action (SUPER_ADMIN creating/managing an Organization itself,
  // where there is no single tenant the entry belongs to) — `entityId` already carries which
  // Organization a Support-Access-style entry concerns, so that's never conflated into this column.
  @Column({ name: 'organization_id', type: 'int', nullable: true })
  organizationId?: number | null;

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