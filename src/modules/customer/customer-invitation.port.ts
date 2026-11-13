/**
 * The seam between customer activation and the account invitation module.
 *
 * CustomerService asks for this provider by token at the moment it has to send an activation e-mail (ModuleRef, never a constructor
 * dependency). When the invitation module is switched on, it provides this token and the activation e-mail becomes an account invitation;
 * when it is not, nothing provides it and CustomerService keeps using its own activation link exactly as before. So customers never lose their
 * activation e-mail, and CustomerModule never depends on the invitation module's entity or table.
 */
export const CUSTOMER_INVITATION_ISSUER = 'CUSTOMER_INVITATION_ISSUER';

/** The Security Deposit a customer's approval raised. The invitation then uses the managed "Customer Invitation (Security Deposit)" template. */
export interface CustomerDepositDetails {
  /** The amount as it is written in the message, e.g. "AED 1,000.00". */
  amountLabel: string;
  /** The customer's reference number (business code). */
  customerReference: string;
}

export interface CustomerInvitationIssueOptions {
  /** Present when a Security Deposit was raised: the message then carries the deposit details and what happens after the payment. */
  deposit?: CustomerDepositDetails;
  /** The staff user who asked for this (a manual resend). Absent when the system did (an approved registration). */
  actorId?: number;
}

export interface CustomerInvitationIssuer {
  /** Whether an invitation can be issued for this customer right now — the account is still waiting to be set up. When it cannot, CustomerService
   *  sends the activation e-mail the way it always has, so the invitation module never makes that e-mail fail for such a customer. */
  canIssueForCustomer(customerId: number): Promise<boolean>;

  /** Issues (or re-issues) the customer's invitation and sends it. Never throws for a delivery failure: it reports `sent: false` with the reason. */
  issueForCustomer(customerId: number, options?: CustomerInvitationIssueOptions): Promise<{ sent: boolean; error?: string }>;
}
