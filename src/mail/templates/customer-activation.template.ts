import { MailTemplate } from '../mail.interfaces';
import { escapeHtml } from './html-escape';
import { renderMailButton, renderMailLayout } from './layout';

export interface CustomerActivationVariables {
  customerName: string;
  customerReference: string;
  activationUrl: string;
  expiryLabel: string;
}

/** No Security Deposit required — the customer can set their password and activate immediately. */
export const customerActivationTemplate: MailTemplate<CustomerActivationVariables> = (v) => {
  const subject = 'Activate your Centrizen customer account';

  const html = renderMailLayout(`
    <p>Hello ${escapeHtml(v.customerName)},</p>
    <p>Your customer account (<strong>${escapeHtml(v.customerReference)}</strong>) has been approved. To finish setting up your account, set your password using the secure link below.</p>
    ${renderMailButton(v.activationUrl, 'Set your password')}
    <p style="color:#6B7280;font-size:12px;">This link expires ${escapeHtml(v.expiryLabel)} and can only be used once. If you did not expect this email, you can safely ignore it.</p>
  `);

  const text = [
    `Hello ${v.customerName},`,
    '',
    `Your customer account (${v.customerReference}) has been approved.`,
    'Set your password using the link below to activate your account:',
    v.activationUrl,
    '',
    `This link expires ${v.expiryLabel} and can only be used once.`,
    'If you did not expect this email, you can safely ignore it.',
  ].join('\n');

  return { subject, html, text };
};
