import { MailTemplate } from '../mail.interfaces';
import { escapeHtml } from './html-escape';
import { renderMailLayout } from './layout';

export interface WorkflowSlaBreachVariables {
  workflowTypeLabel: string;
  businessObjectId: number;
  levelOrder: number;
  /** The SLA deadline, already formatted for the recipient (their time zone and date format — see formatDateTimeForRecipient);
   *  the template never formats a date itself. */
  slaDueLabel: string;
}

/** Sent when a level's SLA deadline has passed with no action and the level is configured to NOTIFY. The deadline HAS passed at
 *  that moment (the sweep only picks up steps whose slaDueAt is in the past), so "which has now passed" is exact. An ESCALATE
 *  breach is not worded this way: the level it tells about was only just activated, its own deadline is still ahead — that mail
 *  is workflowEscalationTemplate.
 *
 *  No deep link to the item — this codebase has no staff-facing frontend base-URL config today
 *  (only CUSTOMER_PORTAL_URL, for the customer-facing portal); adding one is a frontend-routing
 *  decision outside this scheduler's scope, not something to guess at here. */
export const workflowSlaBreachTemplate: MailTemplate<WorkflowSlaBreachVariables> = (v) => {
  const subject = `Approval overdue — ${v.workflowTypeLabel} #${v.businessObjectId} (Level ${v.levelOrder + 1})`;

  const html = renderMailLayout(`
    <p>An approval assigned to your role is overdue.</p>
    <p><strong>${escapeHtml(v.workflowTypeLabel)} #${v.businessObjectId}</strong> has been waiting at <strong>Level ${v.levelOrder + 1}</strong> since its SLA deadline of ${escapeHtml(v.slaDueLabel)}, which has now passed.</p>
    <p>Please review and action this item in the relevant approval screen.</p>
  `);

  const text = [
    'An approval assigned to your role is overdue.',
    '',
    `${v.workflowTypeLabel} #${v.businessObjectId} has been waiting at Level ${v.levelOrder + 1} since its SLA deadline of ${v.slaDueLabel}, which has now passed.`,
    '',
    'Please review and action this item in the relevant approval screen.',
  ].join('\n');

  return { subject, html, text, purpose: 'workflow SLA breach' };
};
