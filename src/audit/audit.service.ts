import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  /**
   * `manager` is optional — pass the CALLER's own transaction manager so this audit insert commits
   * atomically with whatever it's recording, instead of on its own independent connection. Without
   * this, an audit row for an action can commit even when the surrounding transaction that
   * performed the action later fails and rolls back — leaving an audit trail for something that
   * never actually happened. Backward compatible: omitting `manager` uses this service's own
   * injected repository exactly as before.
   */
  async record(dto: CreateAuditLogDto, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.auditRepository;
    const audit = repo.create({
      moduleName: dto.moduleName,
      entityId: dto.entityId,
      action: dto.action,
      oldValue: dto.oldValue === undefined ? null : JSON.stringify(dto.oldValue),
      newValue: dto.newValue === undefined ? null : JSON.stringify(dto.newValue),
      performedBy: dto.performedBy ?? null,
    });

    await repo.save(audit);
  }

  async findByModule(moduleName: string, action?: string | string[], limit = 50) {
    return this.auditRepository.find({
      where: action ? { moduleName, action: Array.isArray(action) ? In(action) : action } : { moduleName },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // Scoped to ONE specific row (moduleName + entityId), not every row in a module — the real
  // "event timeline for this one record" query, backed by this table's own
  // [moduleName, entityId, createdAt] composite index (audit-log.entity.ts), so this is an
  // already-supported, intended access pattern, not a new strain on the schema.
  async findByModuleAndEntity(moduleName: string, entityId: number, action?: string | string[], limit = 50) {
    return this.auditRepository.find({
      where: action
        ? { moduleName, entityId, action: Array.isArray(action) ? In(action) : action }
        : { moduleName, entityId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
