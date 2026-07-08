import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { Tariff, TariffStatus } from './entities/tariff.entity';
import { TARIFF_AUDIT_MODULE_NAME, TariffAuditAction } from './tariff.constants';

// Date-only transitions the Tariff module can own without a Billing Engine:
// deprecating a version once its successor's effective date arrives, and
// expiring a tariff once its own effective-to date has passed. Both are pure
// functions of columns already on `tariffs` — no invoice/billing data needed.
@Injectable()
export class TariffSchedulerService {
  private readonly logger = new Logger(TariffSchedulerService.name);

  constructor(
    @InjectRepository(Tariff) private readonly tariffs: Repository<Tariff>,
    private readonly auditService: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async run(): Promise<void> {
    await this.autoDeprecateSupersededVersions();
    await this.autoExpirePastEffectiveTo();
  }

  // Scenario 5: once a new version's effectiveFrom date arrives, the version
  // it was cloned from is automatically deprecated.
  async autoDeprecateSupersededVersions(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);

    const children = await this.tariffs
      .createQueryBuilder('child')
      .innerJoinAndSelect('child.parentTariff', 'parent')
      .where('child.status = :active', { active: TariffStatus.ACTIVE })
      .andWhere('parent.status = :active', { active: TariffStatus.ACTIVE })
      .andWhere('child.effective_from IS NOT NULL')
      .andWhere('child.effective_from <= :today', { today })
      .getMany();

    for (const child of children) {
      const parent = child.parentTariff!;
      const oldValue = { ...parent };
      parent.status = TariffStatus.DEPRECATED;
      const saved = await this.tariffs.save(parent);
      await this.auditService.record({
        moduleName: TARIFF_AUDIT_MODULE_NAME,
        entityId: parent.id,
        action: TariffAuditAction.AUTO_DEPRECATE,
        oldValue,
        newValue: saved,
        performedBy: null,
      });
      this.logger.log(
        `Auto-deprecated tariff #${parent.id} (${parent.businessCode} v${parent.version}) — superseded by #${child.id} v${child.version}, effective ${child.effectiveFrom}`,
      );
    }

    return children.length;
  }

  // Tariff Editing Rules: "Expired tariff = read only forever" once its
  // effective-to date passes while still active.
  async autoExpirePastEffectiveTo(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);

    const expiring = await this.tariffs
      .createQueryBuilder('tariff')
      .where('tariff.status = :active', { active: TariffStatus.ACTIVE })
      .andWhere('tariff.effective_to IS NOT NULL')
      .andWhere('tariff.effective_to <= :today', { today })
      .getMany();

    for (const tariff of expiring) {
      const oldValue = { ...tariff };
      tariff.status = TariffStatus.EXPIRED;
      const saved = await this.tariffs.save(tariff);
      await this.auditService.record({
        moduleName: TARIFF_AUDIT_MODULE_NAME,
        entityId: tariff.id,
        action: TariffAuditAction.AUTO_EXPIRE,
        oldValue,
        newValue: saved,
        performedBy: null,
      });
      this.logger.log(`Auto-expired tariff #${tariff.id} (${tariff.businessCode} v${tariff.version}) — effective-to ${tariff.effectiveTo} passed`);
    }

    return expiring.length;
  }
}
