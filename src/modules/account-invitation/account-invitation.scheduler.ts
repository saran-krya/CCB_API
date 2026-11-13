import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccountInvitationService } from './account-invitation.service';

/** Marks invitations whose 24 hours ran out as EXPIRED, audits them and sends each invitee the "Invitation Expired" message. Every ten minutes;
 *  a run that is still going is not started twice, and several API instances sharing a database cannot expire the same invitation twice. */
@Injectable()
export class AccountInvitationScheduler {
  private readonly logger = new Logger(AccountInvitationScheduler.name);
  private running = false;

  constructor(private readonly invitations: AccountInvitationService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.invitations.expireDue();
      if (expired > 0) this.logger.log(`${expired} invitation(s) expired`);
    } catch (error) {
      this.logger.error(`The invitation expiry run failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
