import { MailTemplate } from '../mail.interfaces';
import { escapeHtml } from './html-escape';
import { renderMailLayout } from './layout';

export interface WorkflowSlaBreachVariables {
  workflowTypeLabel: string;
  businessObjectId: number;
  levelOrder: number;
  slaDueAt: Date;
}

/** No deep link to the item — this codebase has no staff-facing frontend base-URL config today
 *  (only CUSTOMER_PORTAL_URL, for the customer-facing portal); adding one is a frontend-routing
 *  decision outside this scheduler's scope, not something to guess at here. */
export const workflowSlaBreachTemplate: MailTemplate<WorkflowSlaBreachVariables> = (v) => {
  const subject = `Approval overdue — ${v.workflowTypeLabel} #${v.businessObjectId} (Level ${v.levelOrder + 1})`;
  const dueLabel = v.slaDueAt.toISOString();

  const html = renderMailLayout(`
    <p>An approval assigned to your role is overdue.</p>
    <p><strong>${escapeHtml(v.workflowTypeLabel)} #${v.businessObjectId}</strong> has been waiting at <strong>Level ${v.levelOrder + 1}</strong> since its SLA deadline of ${escapeHtml(dueLabel)}, which has now passed.</p>
    <p>Please review and action this item in the relevant approval screen.</p>
  `);

  const text = [
    'An approval assigned to your role is overdue.',
    '',
    `${v.workflowTypeLabel} #${v.businessObjectId} has been waiting at Level ${v.levelOrder + 1} since its SLA deadline of ${dueLabel}, which has now passed.`,
    '',
    'Please review and action this item in the relevant approval screen.',
  ].join('\n');

  return { subject, html, text };
};
