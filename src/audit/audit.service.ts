import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
}
