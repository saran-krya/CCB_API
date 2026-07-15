import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  async record(dto: CreateAuditLogDto): Promise<void> {
    const audit = this.auditRepository.create({
      moduleName: dto.moduleName,
      entityId: dto.entityId,
      action: dto.action,
      oldValue: dto.oldValue === undefined ? null : JSON.stringify(dto.oldValue),
      newValue: dto.newValue === undefined ? null : JSON.stringify(dto.newValue),
      performedBy: dto.performedBy ?? null,
    });

    await this.auditRepository.save(audit);
  }

  // Generic read surface for any module's own "history" screen (e.g. Meter
  // Management's Import History) — filters by moduleName/action so a caller
  // only sees the audit rows relevant to it, newest first. Returns the raw
  // AuditLog rows; callers are responsible for JSON.parse'ing oldValue/newValue
  // into whatever shape they wrote via record() above. `action` accepts a
  // single action or several (e.g. a history view that needs to show both
  // 'IMPORT' and 'IMPORT_FAILED' rows together) — TypeORM's `In()` handles
  // both a single-element and multi-element array identically.
  async findByModule(moduleName: string, action?: string | string[], limit = 50) {
    return this.auditRepository.find({
      where: action ? { moduleName, action: Array.isArray(action) ? In(action) : action } : { moduleName },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
