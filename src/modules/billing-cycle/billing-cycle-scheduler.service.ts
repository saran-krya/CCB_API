import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingCycleService } from './billing-cycle.service';

@Injectable()
export class BillingCycleSchedulerService {
  private readonly logger = new Logger(BillingCycleSchedulerService.name);

  constructor(private readonly billingCycles: BillingCycleService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async run(): Promise<void> {
    await this.autoActivatePendingVersions();
    await this.autoDeprecateScheduledCycles();
  }

  async autoActivatePendingVersions(): Promise<number> {
    const activated = await this.billingCycles.autoActivateDueVersions();
    if (activated > 0) {
      this.logger.log(`Auto-activated ${activated} billing cycle version(s) whose effective date arrived`);
    }
    return activated;
  }

  async autoDeprecateScheduledCycles(): Promise<number> {
    const deprecated = await this.billingCycles.autoDeprecateDueCycles();
    if (deprecated > 0) {
      this.logger.log(`Auto-deprecated ${deprecated} billing cycle(s) whose scheduled deprecation date arrived`);
    }
    return deprecated;
  }
}
