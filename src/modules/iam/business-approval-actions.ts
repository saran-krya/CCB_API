import { WorkflowType } from '../workflow/dto/workflow.dto';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';

export const BUSINESS_APPROVAL_ACTION_CODES: ReadonlySet<string> = new Set([
  ACTION_CODES.TARIFF_APPROVE,
  ACTION_CODES.TARIFF_REJECT,
  ACTION_CODES.BILLING_CYCLE_APPROVE,
  ACTION_CODES.BILLING_CYCLE_REJECT,
  // Gates Approve, Reject and Return of a bill run together.
  ACTION_CODES.BILL_RUN_APPROVE,
  ACTION_CODES.BILL_RUN_HISTORICAL_APPROVE,
  ACTION_CODES.APPROVE_REGISTRATION_REQUEST,
  ACTION_CODES.REJECT_REGISTRATION_REQUEST,
  ACTION_CODES.METER_READING_APPROVE,
]);

/**
 * Catalogue codes whose names read like approvals but are deliberately NOT business approvals, with the
 * reason — so the classification test can tell "reviewed and kept" from "forgotten".
 */
export const NOT_BUSINESS_APPROVAL_ACTION_CODES: Readonly<Record<string, string>> = {
  WORKFLOW_MANAGE_APPROVERS:
    'System configuration: chooses WHICH roles approve each workflow. It decides no business record, so SUPER_ADMIN keeps it.',
  REGISTRATION_APPROVAL_DEPOSIT_MANAGE:
    'Deposit handling on the registration screen, not an approve/reject decision. Every route it gates also accepts ' +
    'EDIT_REGISTRATION_REQUEST, so SUPER_ADMIN reaches them either way: moving it into the set above would change nothing ' +
    'at runtime. Left out pending a business decision.',
};

/** The action code(s) that let a role approve each workflow type — a role is an eligible approver for a
 *  workflow level only while it holds one of them (see IamService.getRoleIdsHoldingAnyAction). */
export const APPROVE_ACTION_CODES: Record<WorkflowType, string[]> = {
  [WorkflowType.TARIFF]: [ACTION_CODES.TARIFF_APPROVE],
  [WorkflowType.BILL_RUN]: [ACTION_CODES.BILL_RUN_APPROVE],
  [WorkflowType.BILLING_CYCLE]: [ACTION_CODES.BILLING_CYCLE_APPROVE],
};

export const isBusinessApprovalActionCode = (code: string): boolean => BUSINESS_APPROVAL_ACTION_CODES.has(code);
