import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingCycleService } from './billing-cycle.service';

// Single nightly entry point for every date-only Billing Cycle lifecycle
// transition — mirrors TariffSchedulerService's shape (one cron, multiple
// independent sweeps run from it, each also exposed as its own method for
// manual/ops use and unit testing). Midnight is appropriate because every
// date this module reasons about (effectiveFrom, deprecatedOn) is a `date`
// column with no time component — the rule is "on this calendar day", not
// "at this instant", so a once-daily sweep at the lowest-traffic hour is
// exactly the right granularity. Extending this module with another
// scheduled lifecycle event later means adding one more method here and one
// more line in run() — nothing else changes.
@Injectable()
export class BillingCycleSchedulerService {
  private readonly logger = new Logger(BillingCycleSchedulerService.name);

  constructor(private readonly billingCycles: BillingCycleService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async run(): Promise<void> {
    await this.autoActivatePendingVersions();
    await this.autoDeprecateScheduledCycles();
  }

  // Promotes every approved-but-still-pending version whose effectiveFrom
  // date has arrived (and deprecates the version it replaces, in the same step).
  async autoActivatePendingVersions(): Promise<number> {
    const activated = await this.billingCycles.autoActivateDueVersions();
    if (activated > 0) {
      this.logger.log(`Auto-activated ${activated} billing cycle version(s) whose effective date arrived`);
    }
    return activated;
  }

  // Applies every deprecation that was recorded (via deprecate()) with a
  // future effectiveDeprecationDate which has now arrived.
  async autoDeprecateScheduledCycles(): Promise<number> {
    const deprecated = await this.billingCycles.autoDeprecateDueCycles();
    if (deprecated > 0) {
      this.logger.log(`Auto-deprecated ${deprecated} billing cycle(s) whose scheduled deprecation date arrived`);
    }
    return deprecated;
  }
}
