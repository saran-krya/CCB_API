import { MailTemplate } from '../mail.interfaces';
import { escapeHtml } from './html-escape';
import { renderMailLayout } from './layout';

export interface WorkflowEscalationVariables {
  workflowTypeLabel: string;
  businessObjectId: number;
  /** 0-based position of the level that missed its SLA deadline. */
  fromLevelOrder: number;
  /** 0-based position of the level the item moved to — the recipient's own. */
  toLevelOrder: number;
  /** The new level's own SLA deadline, already formatted for the recipient (their time zone and date format — see
   *  formatDateTimeForRecipient); the template never formats a date itself. */
  newSlaDueLabel: string;
}

/** Sent to the approvers of the NEXT level when an item is escalated to them after the previous level missed its SLA. It is not
 *  the breach notice (workflowSlaBreachTemplate): the level that is being told about was only just activated, so its own
 *  deadline is still ahead — the wording says why the item reached the recipient and when it is due, and never claims a
 *  deadline has passed. Same as the breach notice, no deep link: there is no staff-facing frontend base-URL config today. */
export const workflowEscalationTemplate: MailTemplate<WorkflowEscalationVariables> = (v) => {
  const fromLevel = v.fromLevelOrder + 1;
  const toLevel = v.toLevelOrder + 1;
  const subject = `Approval escalated to you — ${v.workflowTypeLabel} #${v.businessObjectId} (Level ${toLevel})`;

  const html = renderMailLayout(`
    <p>An approval has been escalated to your role.</p>
    <p><strong>${escapeHtml(v.workflowTypeLabel)} #${v.businessObjectId}</strong> was not actioned at <strong>Level ${fromLevel}</strong> before its SLA deadline, so it has moved to <strong>Level ${toLevel}</strong>, which is assigned to your role.</p>
    <p>Please review and action it by ${escapeHtml(v.newSlaDueLabel)}, the SLA deadline for Level ${toLevel}, in the relevant approval screen.</p>
  `);

  const text = [
    'An approval has been escalated to your role.',
    '',
    `${v.workflowTypeLabel} #${v.businessObjectId} was not actioned at Level ${fromLevel} before its SLA deadline, so it has moved to Level ${toLevel}, which is assigned to your role.`,
    '',
    `Please review and action it by ${v.newSlaDueLabel}, the SLA deadline for Level ${toLevel}, in the relevant approval screen.`,
  ].join('\n');

  return { subject, html, text, purpose: 'workflow escalation' };
};
