// How the Policy editor presents an Action — its "access level" (Read / Write / Manage access) and the
// short label shown next to its checkbox. Owned by the API and sent with every resource's
// available actions (see IamService.findAllResourcesWithActions), so the web client carries no copy of the
// naming conventions or the label allowlist.
//
// Presentation only: derived from each action code's own naming convention, it introduces no new backend
// concept or schema field and never decides what is actually granted (the action codes themselves do).

export type AccessLevel = 'read' | 'write' | 'permissions';

// Order: Read, Write, Manage access. `order` is what clients sort the sections by.
const ACCESS_LEVELS: Record<AccessLevel, { label: string; order: number }> = {
  read: { label: 'Read', order: 1 },
  write: { label: 'Write', order: 2 },
  permissions: { label: 'Manage access', order: 3 },
};

//   - Read: view/list/detail actions (VIEW_* / *_VIEW).
//   - Write: every state-changing action — create, edit, delete, submit, approve, reject,
//     activate/deactivate, export, import, and any other resource-specific capability.
//   - Manage access (key `permissions`): actions that grant or configure who else has access. Deliberately
//     narrow — not "any action that sounds administrative". Widen only if a future action code genuinely
//     manages who has access; never to catch ordinary business actions like approve/reject/export.
const READ_PREFIX = /^VIEW_/;
const READ_SUFFIX = /_VIEW$/;
const PERMISSIONS_MANAGEMENT_PATTERN = /MANAGE_APPROVERS|ATTACH_POLICY|DETACH_POLICY|MANAGE_PERMISSIONS/;

export function getAccessLevel(code: string): AccessLevel {
  if (PERMISSIONS_MANAGEMENT_PATTERN.test(code)) return 'permissions';
  if (READ_PREFIX.test(code) || READ_SUFFIX.test(code)) return 'read';
  return 'write';
}

// Simplified labels for the editor's two-panel workspace. The real Action.name stays fully descriptive ("View
// Tariff Detail", ...) and unique (actions.name has a DB-level unique index). These codes are exactly the
// surviving codes from the permission-code consolidation (migration 1792800000000-ConsolidateDuplicateActionCodes
// CODE_MERGE_MAP) — each absorbed duplicate codes for the same capability, so a bare verb is accurate: the
// editor's resource header already makes the resource-specific suffix redundant. An allowlist, not a heuristic,
// so an action whose full name is still the right thing to show is never over-simplified.
const ACTION_DISPLAY_LABELS: Record<string, string> = {
  VIEW_USER: 'View',
  CREATE_USER: 'Create',
  EDIT_USER: 'Edit',
  DELETE_USER: 'Delete',
  TARIFF_VIEW: 'View',
  TARIFF_APPROVE: 'Approve',
  TARIFF_REJECT: 'Reject',
  VIEW_BILLING_CYCLE: 'View',
  BILLING_CYCLE_APPROVE: 'Approve',
  BILLING_CYCLE_REJECT: 'Reject',
  VIEW_REGISTRATION_REQUESTS: 'View',
  APPROVE_REGISTRATION_REQUEST: 'Approve',
  REJECT_REGISTRATION_REQUEST: 'Reject',
};

export interface ActionPresentation {
  accessLevel: AccessLevel;
  accessLevelLabel: string;
  accessLevelOrder: number;
  displayLabel: string;
}

export function describeAction(code: string, name: string): ActionPresentation {
  const accessLevel = getAccessLevel(code);
  const { label, order } = ACCESS_LEVELS[accessLevel];
  return {
    accessLevel,
    accessLevelLabel: label,
    accessLevelOrder: order,
    displayLabel: ACTION_DISPLAY_LABELS[code] ?? name,
  };
}
