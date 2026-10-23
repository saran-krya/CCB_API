/**
 * The reviewed, final Resource-to-Action mapping covering all 96 existing Action codes (confirmed
 * exhaustive — every code in `bootstrap/seed-data.ts`'s ACTIONS array maps to exactly one Resource
 * below; verified by direct enumeration, not sampling). No action is ambiguous or left unmapped —
 * the mapping follows each action's existing `screenCode` directly, collapsing the handful of
 * confirmed duplicate-code screen pairs (Meter Information/Inventory, Tariff Config/Approval,
 * Billing Cycle/Approval, Registration Requests/Approval) onto one Resource each, since those pairs
 * were already established (via the RBAC security assessment) to be two OR'd codes for the exact
 * same underlying capability — the IAM model's single-Resource, multi-action-code statement is a
 * more faithful representation of that than two parallel codes ever was.
 *
 * Resources are seeded idempotently via `ensureResourceCatalog` (IamService), the same pattern
 * ActionsService.ensureCriticalDefaults already uses for Actions — safe to re-run on every boot,
 * self-healing if a row's name/displayOrder drifts from this source of truth.
 *
 * `parentResourceCode` is display-grouping ONLY (see Resource entity's own doc comment) — METER
 * is METER_INVENTORY's parent purely so the Policy editor's resource picker can show them nested;
 * it has no effect on what a statement referencing METER_INVENTORY actually grants.
 */
export interface SeedResource {
  code: string;
  name: string;
  description?: string;
  parentResourceCode?: string;
  displayOrder: number;
  /** Every Action code from seed-data.ts's ACTIONS array that this Resource covers. */
  actionCodes: string[];
}

export const RESOURCES: SeedResource[] = [
  {
    code: 'USER',
    name: 'Users',
    description: 'Staff user accounts',
    displayOrder: 1,
    actionCodes: ['VIEW_USER', 'USER_OVERVIEW', 'CREATE_USER', 'EDIT_USER', 'DELETE_USER'],
  },
  {
    code: 'ROLE',
    name: 'Roles',
    description: 'Role definitions and their attached policies',
    displayOrder: 2,
    actionCodes: ['VIEW_ROLE', 'CREATE_ROLE', 'EDIT_ROLE', 'DELETE_ROLE'],
  },
  {
    code: 'ATTRIBUTE',
    name: 'System Attributes',
    description: 'Global and scoped configuration attributes',
    displayOrder: 3,
    actionCodes: ['VIEW_ATTRIBUTE', 'CREATE_ATTRIBUTE', 'EDIT_ATTRIBUTE', 'DELETE_ATTRIBUTE'],
  },
  {
    code: 'TARIFF',
    name: 'Tariffs',
    description: 'Tariff configuration and Finance approval',
    displayOrder: 4,
    actionCodes: [
      'TARIFF_CREATE', 'TARIFF_SUBMIT', 'TARIFF_EDIT', 'TARIFF_DEACTIVATE', 'TARIFF_REACTIVATE',
      'TARIFF_DEPRECATE', 'TARIFF_NEW_VERSION', 'TARIFF_VIEW', 'TARIFF_APPROVAL_QUEUE',
      'TARIFF_APPROVE', 'TARIFF_REJECT', 'TARIFF_APPROVAL_VIEW', 'TARIFF_APPROVAL_APPROVE',
      'TARIFF_APPROVAL_REJECT',
    ],
  },
  {
    code: 'WORKFLOW',
    name: 'Approval Workflows',
    description: 'Multi-level approval chain configuration (Tariff, Billing Cycle, Bill Run)',
    displayOrder: 5,
    actionCodes: ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE_APPROVERS'],
  },
  {
    code: 'BILLING_CYCLE',
    name: 'Billing Cycles',
    description: 'Billing cycle configuration and Finance approval',
    displayOrder: 6,
    actionCodes: [
      'CREATE_BILLING_CYCLE', 'BILLING_CYCLE_RESUBMIT', 'BILLING_CYCLE_NEW_VERSION',
      'BILLING_CYCLE_DEPRECATE', 'VIEW_BILLING_CYCLE', 'BILLING_CYCLE_APPROVE',
      'BILLING_CYCLE_REJECT', 'EXPORT_BILLING_CYCLE', 'BILLING_CYCLE_APPROVAL_VIEW',
      'BILLING_CYCLE_APPROVAL_APPROVE', 'BILLING_CYCLE_APPROVAL_REJECT',
    ],
  },
  {
    code: 'BILL_RUN',
    name: 'Bill Runs',
    description: 'Bill run submission, review, and approval',
    displayOrder: 7,
    actionCodes: [
      'BILL_RUN_VIEW', 'BILL_RUN_APPROVE', 'BILL_RUN_SUBMIT', 'BILLING_READINESS_VIEW',
      // BILL_RUN_HISTORICAL_SUBMIT/APPROVE: confirmed live in the database (isActive, 4 real role
      // grants: SUPER_ADMIN, CUSTOMER_SERVICE_EXECUTIVE, FINANCE, Cheif_Officer) but NOT present in
      // seed-data.ts's ACTIONS array and NOT referenced by any @Permission decorator anywhere in the
      // codebase — pre-provisioned grants for the "Historical / Missed Billing Cycle" feature that
      // was explicitly scoped as design-only (audit + plan, no implementation) earlier in this
      // project's history. Included here under BILL_RUN (the natural resource for a historical
      // variant of bill-run submit/approve) specifically to PRESERVE these roles' existing grants
      // through the migration (dropping them would violate the "preserve exact effective
      // permissions" requirement) — not because the underlying feature is confirmed built. If/when
      // the historical billing feature is actually implemented, its real routes should be
      // @Permission-decorated with these exact codes rather than inventing new ones.
      'BILL_RUN_HISTORICAL_SUBMIT', 'BILL_RUN_HISTORICAL_APPROVE',
    ],
  },
  {
    code: 'COMMUNITY',
    name: 'Communities',
    displayOrder: 8,
    actionCodes: ['VIEW_COMMUNITY', 'CREATE_COMMUNITY', 'EDIT_COMMUNITY', 'DELETE_COMMUNITY', 'COMMUNITY_STATUS'],
  },
  {
    code: 'PROPERTY',
    name: 'Properties',
    displayOrder: 9,
    actionCodes: ['VIEW_PROPERTY', 'CREATE_PROPERTY', 'EDIT_PROPERTY', 'DELETE_PROPERTY', 'PROPERTY_STATUS'],
  },
  {
    code: 'UNIT',
    name: 'Units',
    displayOrder: 10,
    actionCodes: ['VIEW_UNIT', 'CREATE_UNIT', 'EDIT_UNIT', 'DELETE_UNIT', 'UNIT_OCCUPANCY'],
  },
  {
    code: 'CUSTOMER',
    name: 'Customers',
    displayOrder: 11,
    actionCodes: ['VIEW_CUSTOMER', 'CREATE_CUSTOMER', 'EDIT_CUSTOMER', 'DELETE_CUSTOMER'],
  },
  {
    code: 'REGISTRATION_REQUEST',
    name: 'Registration Requests',
    description: 'Registration request lifecycle and approval, including deposit management',
    displayOrder: 12,
    actionCodes: [
      'VIEW_REGISTRATION_REQUESTS', 'CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST',
      'APPROVE_REGISTRATION_REQUEST', 'REJECT_REGISTRATION_REQUEST', 'REGISTRATION_APPROVAL_VIEW',
      'REGISTRATION_APPROVAL_APPROVE', 'REGISTRATION_APPROVAL_REJECT',
      'REGISTRATION_APPROVAL_DEPOSIT_MANAGE',
    ],
  },
  {
    code: 'SERVICE_REQUEST_TICKET',
    name: 'Service Requests & Tickets',
    description: 'Not yet implemented as a feature — Resource reserved for the seeded placeholder Action',
    displayOrder: 13,
    actionCodes: ['VIEW_SERVICE_REQUESTS_TICKETS'],
  },
  {
    code: 'REGISTRATION_DOCUMENT_RULE',
    name: 'Document Set Definition',
    displayOrder: 14,
    actionCodes: ['VIEW_REGISTRATION_DOCUMENT_RULES', 'EDIT_REGISTRATION_DOCUMENT_RULES'],
  },
  {
    code: 'LOV',
    name: 'List of Values',
    displayOrder: 15,
    actionCodes: ['LOV_VIEW', 'LOV_CREATE', 'LOV_EDIT', 'LOV_DELETE', 'LOV_MODULE_ASSIGN'],
  },
  {
    code: 'METER',
    name: 'Meters',
    description: 'Meter Information and Meter Inventory (collapsed from two duplicate-code screens)',
    displayOrder: 16,
    actionCodes: ['METER_VIEW', 'METER_EXPORT', 'METER_MAPPING', 'METER_CREATE', 'METER_IMPORT'],
  },
  {
    code: 'METER_INVENTORY',
    name: 'Meter Inventory',
    parentResourceCode: 'METER',
    displayOrder: 17,
    actionCodes: [
      'METER_INVENTORY_VIEW', 'METER_INVENTORY_EXPORT', 'METER_INVENTORY_CREATE',
      'METER_INVENTORY_EDIT', 'METER_INVENTORY_DELETE',
    ],
  },
  {
    code: 'METER_READING',
    name: 'Meter Readings',
    displayOrder: 18,
    actionCodes: ['METER_READING_APPROVE'],
  },
  {
    code: 'IMPORT_CENTER',
    name: 'Import Center',
    displayOrder: 19,
    actionCodes: ['IMPORT_CENTER_VIEW'],
  },
  {
    code: 'SFTP_MONITOR',
    name: 'SFTP File Monitor',
    displayOrder: 20,
    actionCodes: ['SFTP_MONITOR_VIEW', 'SFTP_MONITOR_TRIGGER'],
  },
  {
    code: 'BILL',
    name: 'Bills (Invoices)',
    displayOrder: 21,
    actionCodes: ['BILLING_VIEW', 'BILLING_CANCEL'],
  },
];

/** Reverse lookup built once, used by ActionResourceMapService — every Action code maps to exactly
 *  one Resource code. Throws at module load if the mapping ever has a real duplicate (a code
 *  assigned to two Resources), which would be a mapping bug, not a runtime condition to tolerate. */
export const ACTION_TO_RESOURCE_CODE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const resource of RESOURCES) {
    for (const actionCode of resource.actionCodes) {
      if (map[actionCode]) {
        throw new Error(`Action code ${actionCode} is mapped to both ${map[actionCode]} and ${resource.code}`);
      }
      map[actionCode] = resource.code;
    }
  }
  return map;
})();
