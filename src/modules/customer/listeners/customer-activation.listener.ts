import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CustomerActivationRequiredEvent, CUSTOMER_ACTIVATION_REQUIRED_EVENT } from '../events/customer-activation-required.event';
import { CustomerService } from '../customer.service';

/**
 * Runs OUTSIDE the Registration Approval transaction, by construction: @nestjs/event-emitter's
 * default (synchronous, in-process) EventEmitter2 still only ever fires an emitted event's
 * listeners after the emitting call has returned — and RegistrationRequestService only emits this
 * event once its own `this.dataSource.transaction(...)` block has already resolved (see
 * raiseDepositDemandIfRequired's caller). So a slow or failing SMTP send here can never roll back,
 * or even delay the commit of, the approval/customer-creation transaction that triggered it.
 *
 * A thrown error here is caught and logged (never rethrown) — CustomerService.issueActivationEmail
 * already reports delivery failures via its return value rather than throwing, so this is a second,
 * defensive layer in case something upstream of that (e.g. the customer lookup itself) throws.
 */
@Injectable()
export class CustomerActivationListener {
  private readonly logger = new Logger(CustomerActivationListener.name);

  constructor(private readonly customers: CustomerService) {}

  @OnEvent(CUSTOMER_ACTIVATION_REQUIRED_EVENT, { async: true })
  async handle(event: CustomerActivationRequiredEvent): Promise<void> {
    try {
      const result = await this.customers.issueActivationEmail(event.customerId, event.depositAmount);
      if (!result.sent) {
        this.logger.error(`Activation email failed for customer ${event.customerId}: ${result.error}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Unexpected error issuing activation email for customer ${event.customerId}: ${message}`);
    }
  }
}
