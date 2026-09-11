export const CUSTOMER_ACTIVATION_REQUIRED_EVENT = 'customer.activation-required';

/**
 * Emitted once, right after the Registration Approval transaction that decided whether a Security
 * Deposit is required has fully committed (see RegistrationRequestService.raiseDepositDemandIfRequired)
 * — never from inside that transaction, so a transient SMTP failure can never affect approval/customer
 * creation. `depositAmount`/`depositCurrency` are present only when a deposit was actually raised;
 * their absence is exactly how the listener picks which email template to send.
 */
export class CustomerActivationRequiredEvent {
  constructor(
    public readonly customerId: number,
    public readonly depositAmount?: number,
  ) {}
}
