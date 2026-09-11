import { MailTemplate } from '../mail.interfaces';
import { escapeHtml } from './html-escape';
import { renderMailButton, renderMailLayout } from './layout';

export interface SecurityDepositPaymentVariables {
  customerName: string;
  customerReference: string;
  depositAmountLabel: string;
  activationUrl: string;
  expiryLabel: string;
}

/** Security Deposit required — the same activation link both sets the customer's password and
 *  carries them to the deposit payment step; the account itself only activates once the payment is
 *  verified (see RegistrationRequestService.verifyDeposit). */
export const securityDepositPaymentTemplate: MailTemplate<SecurityDepositPaymentVariables> = (v) => {
  const subject = 'Complete your Centrizen customer account setup';

  const html = renderMailLayout(`
    <p>Hello ${escapeHtml(v.customerName)},</p>
    <p>Your customer account (<strong>${escapeHtml(v.customerReference)}</strong>) has been approved. A Security Deposit of <strong>${escapeHtml(v.depositAmountLabel)}</strong> is required before your account can be activated.</p>
    <p>Use the secure link below to set your password and complete the deposit payment.</p>
    ${renderMailButton(v.activationUrl, 'Set password & pay deposit')}
    <p style="color:#6B7280;font-size:12px;">This link expires ${escapeHtml(v.expiryLabel)} and can only be used once. Your account will be activated once the deposit payment is verified. If you did not expect this email, you can safely ignore it.</p>
  `);

  const text = [
    `Hello ${v.customerName},`,
    '',
    `Your customer account (${v.customerReference}) has been approved.`,
    `A Security Deposit of ${v.depositAmountLabel} is required before your account can be activated.`,
    'Use the link below to set your password and complete the deposit payment:',
    v.activationUrl,
    '',
    `This link expires ${v.expiryLabel} and can only be used once.`,
    'Your account will be activated once the deposit payment is verified.',
    'If you did not expect this email, you can safely ignore it.',
  ].join('\n');

  return { subject, html, text };
};
