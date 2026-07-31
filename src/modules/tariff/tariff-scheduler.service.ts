import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { TariffStatus, TariffVersion } from './entities/tariff-version.entity';
import { TARIFF_AUDIT_MODULE_NAME, TariffAuditAction } from './tariff.constants';

@Injectable()
export class TariffSchedulerService {
  private readonly logger = new Logger(TariffSchedulerService.name);

  constructor(
    @InjectRepository(TariffVersion) private readonly versions: Repository<TariffVersion>,
    private readonly auditService: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async run(): Promise<void> {
    await this.autoDeprecateSupersededVersions();
    await this.autoExpirePastEffectiveTo();
  }

  async autoDeprecateSupersededVersions(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);

    const children = await this.versions
      .createQueryBuilder('child')
      .innerJoinAndSelect('child.parentVersion', 'parent')
      .leftJoinAndSelect('parent.master', 'parentMaster')
      .where('child.status = :active', { active: TariffStatus.ACTIVE })
      .andWhere('parent.status = :active', { active: TariffStatus.ACTIVE })
      .andWhere('child.effective_from IS NOT NULL')
      .andWhere('child.effective_from <= :today', { today })
      .getMany();

    for (const child of children) {
      const parent = child.parentVersion!;
      const oldValue = { ...parent };
      parent.status = TariffStatus.DEPRECATED;
      const saved = await this.versions.save(parent);
      await this.auditService.record({
        moduleName: TARIFF_AUDIT_MODULE_NAME,
        entityId: parent.id,
        action: TariffAuditAction.AUTO_DEPRECATE,
        oldValue,
        newValue: saved,
        performedBy: null,
      });
      this.logger.log(
        `Auto-deprecated tariff #${parent.id} (${parent.master?.businessCode} v${parent.version}) — superseded by #${child.id} v${child.version}, effective ${child.effectiveFrom}`,
      );
    }

    return children.length;
  }

  async autoExpirePastEffectiveTo(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);

    const expiring = await this.versions
      .createQueryBuilder('version')
      .leftJoinAndSelect('version.master', 'master')
      .where('version.status = :active', { active: TariffStatus.ACTIVE })
      .andWhere('version.effective_to IS NOT NULL')
      .andWhere('version.effective_to <= :today', { today })
      .getMany();

    for (const version of expiring) {
      const oldValue = { ...version };
      version.status = TariffStatus.EXPIRED;
      const saved = await this.versions.save(version);
      await this.auditService.record({
        moduleName: TARIFF_AUDIT_MODULE_NAME,
        entityId: version.id,
        action: TariffAuditAction.AUTO_EXPIRE,
        oldValue,
        newValue: saved,
        performedBy: null,
      });
      this.logger.log(
        `Auto-expired tariff #${version.id} (${version.master?.businessCode} v${version.version}) — effective-to ${version.effectiveTo} passed`,
      );
    }

    return expiring.length;
  }
}
