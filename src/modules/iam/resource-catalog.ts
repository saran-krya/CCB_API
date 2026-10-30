/**
 * The reviewed, final Resource-to-Action mapping — every code in `bootstrap/seed-data.ts`'s ACTIONS
 * array maps to exactly one Resource below, EXCEPT five deliberately nav-visibility-only codes
 * (VIEW_POLICY, CREATE_POLICY, EDIT_POLICY, DELETE_POLICY, VIEW_RESOURCE — see their own comment in
 * seed-data.ts) which intentionally have no Resource mapping: Policy/Resource administration is gated
 * by the unchanged `@Roles(SUPER_ADMIN)` check, independent of whether a role holds these codes. Every
 * other action is unambiguous and mapped — the mapping follows each action's existing `screenCode`
 * directly, collapsing the handful of confirmed duplicate-code screen
 * pairs (Meter Information/Inventory, Tariff Config/Approval, Billing Cycle/Approval, Registration
 * Requests/Approval) onto one Resource each, since those pairs were already established (via the
 * RBAC security assessment) to be two OR'd codes for the exact same underlying capability — the IAM
 * model's single-Resource, multi-action-code statement is a more faithful representation of that
 * than two parallel codes ever was.
 *
 * PERMISSION CONSOLIDATION (post-96-code count): within that same "two codes, one real capability"
 * pattern, 11 further codes were confirmed — via @Permission(...) decorator co-occurrence across
 * every controller, plus seed-data.ts's own descriptions explicitly calling them "an alternate to
 * X, the same underlying action" — to be the Tariff Config/Approval, Billing Cycle/Approval and
 * Registration Requests/Approval screen pairs' OWN View/Approve/Reject duplicates, never
 * independently meaningful. They were folded onto one surviving code each (see
 * 1792800000000-ConsolidateDuplicateActionCodes.ts for the exact before/after map, the data
 * migration, and the `isActive: false` retirement) — originally VIEW_USER → USER_OVERVIEW, LATER
 * corrected the other way (see 1792900000000-RenameUserOverviewToViewUser.ts): USER_OVERVIEW →
 * VIEW_USER, since USER_OVERVIEW was itself a tab-named survivor ("Overview" names a screen, not
 * the Users resource's View capability) — the two rows were swapped rather than renamed in place
 * (actions.code has the same unique index as actions.name), so the net, current state is VIEW_USER
 * active / USER_OVERVIEW retired, with every policy_statements reference migrated accordingly;
 * TARIFF_APPROVAL_VIEW and TARIFF_APPROVAL_QUEUE → TARIFF_VIEW; TARIFF_APPROVAL_APPROVE → TARIFF_APPROVE;
 * TARIFF_APPROVAL_REJECT → TARIFF_REJECT; BILLING_CYCLE_APPROVAL_VIEW → VIEW_BILLING_CYCLE;
 * BILLING_CYCLE_APPROVAL_APPROVE → BILLING_CYCLE_APPROVE; BILLING_CYCLE_APPROVAL_REJECT →
 * BILLING_CYCLE_REJECT; REGISTRATION_APPROVAL_VIEW → VIEW_REGISTRATION_REQUESTS;
 * REGISTRATION_APPROVAL_APPROVE → APPROVE_REGISTRATION_REQUEST; REGISTRATION_APPROVAL_REJECT →
 * REJECT_REGISTRATION_REQUEST. Retired codes are REMOVED from the arrays below (not merely marked
 * inactive here) so a fresh install never creates them and no new/edited Policy can ever select them
 * again. Each surviving code's stored Action.name is UNCHANGED (still its original, fully-descriptive
 * value, e.g. "View Tariff Detail") — `actions.name` has a DB-level unique index, confirmed the hard
 * way when an earlier draft of this migration tried renaming every survivor to a shared bare
 * "View"/"Approve"/"Reject" and failed outright. The simplified bare-verb labels the Policy editor
 * actually displays live purely in CCB_WEB (components/role/actionDisplayLabels.ts), a presentation
 * lookup keyed by these same 13 codes, never written back to the database.
 *
 * BROADER AUDIT (confirming the model is resource-based, not tab-based, beyond just these 11):
 * every OTHER action in every OTHER Resource below was checked — via the same @Permission(...)
 * decorator inspection, plus this codebase's own extensive PRIOR history of tab-consolidation work
 * for Billing Readiness/Bill Run (6 separate past migrations: CollapseBillingReadinessTabScreens,
 * RemoveBillingReadinessPropertyView, MoveRunBillingToBillingReadiness, and others — BILLING_READINESS_VIEW
 * is already "the single permission for the entire sub-module," merged from several prior
 * screen-level codes; BILL_RUN_VIEW stays separate because Bill Run Register and Billing Readiness
 * are genuinely different screens/capabilities, not a tab split of the same one) — and found no
 * further same-capability duplicates. Status-change actions (COMMUNITY_STATUS, PROPERTY_STATUS,
 * UNIT_OCCUPANCY) each gate exactly one real endpoint, separately from their resource's EDIT action,
 * by design — a sensitive capability kept apart from ordinary field edits, same pattern as
 * Approve/Reject being kept apart from View. METER_MAPPING is a deliberately narrower permission
 * carved out of METER_INVENTORY_EDIT (service-enforced: holding only METER_MAPPING can change which
 * unit a sub meter is mapped to, nothing else) — a real, enforced field-level boundary, not a UI
 * artifact. Genuinely distinct business permissions on the SAME resource (e.g. TARIFF_SUBMIT/
 * DEACTIVATE/REACTIVATE/DEPRECATE/NEW_VERSION, BILLING_CYCLE_RESUBMIT/EXPORT,
 * REGISTRATION_APPROVAL_DEPOSIT_MANAGE, LOV_MODULE_ASSIGN) were left untouched — none were ever
 * OR'd with anything as an "alternate code," each is its own capability, and must stay individually
 * grantable/revocable.
 *
 * DEAD CODE RETIREMENT (RBAC cleanup audit, 1793100000000-RetireDeadActionCodes.ts): a further,
 * separate check — not for same-capability duplicates but for codes with NO real capability behind
 * them at all — found CREATE_ATTRIBUTE/DELETE_ATTRIBUTE (attribute.controller.ts never had a
 * create/delete route or service method on either side) and EXPORT_BILLING_CYCLE (billing-cycle.
 * controller.ts never had an export route either, correcting this comment's own earlier "left
 * untouched as a distinct capability" claim above — it was never actually wired to anything).
 * Retired the same way as the 11 consolidated codes above (isActive: false, removed from these
 * arrays, stripped from any policy_statements that held them) since there is no survivor to fold
 * onto. Separately, METER_EXPORT (METER resource, below) was found to be a live, seeded, policy-
 * attachable code that gates NOTHING — meters/master-meters/export and /sub-meters/export only ever
 * checked METER_VIEW/METER_INVENTORY_EXPORT — so it was wired into both routes instead of retired
 * (a real capability with a missing guard, not dead weight).
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
    // VIEW_USER is the live "View" capability (confirmed via 1792900000000-RenameUserOverviewToViewUser.ts —
    // USER_OVERVIEW, which had been the surviving code since it was the one actually wired to real
    // routes, was itself a tab-named code ("Overview" names a screen, not a capability); the two rows
    // were swapped so the Resource's common View permission is properly named after what it does).
    // RESET_USER_PASSWORD is the "Manage sign-in access" dialog's permission — deliberately a sibling
    // of EDIT_USER here, not a child of it, since the Policy model has no concept of parent/child
    // grants within one Resource; parentActionCode in seed-data.ts only affects seeding ORDER, not
    // this Resource-level grouping.
    actionCodes: ['VIEW_USER', 'CREATE_USER', 'EDIT_USER', 'DELETE_USER', 'RESET_USER_PASSWORD'],
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
    // CREATE_ATTRIBUTE/DELETE_ATTRIBUTE retired — no create/delete route or service method ever
    // existed (RBAC cleanup audit); see 1793100000000-RetireDeadActionCodes.ts.
    actionCodes: ['VIEW_ATTRIBUTE', 'EDIT_ATTRIBUTE'],
  },
  {
    code: 'TARIFF',
    name: 'Tariffs',
    description: 'Tariff configuration and Finance approval',
    displayOrder: 4,
    // TARIFF_APPROVAL_VIEW/QUEUE folded into TARIFF_VIEW; TARIFF_APPROVAL_APPROVE into TARIFF_APPROVE;
    // TARIFF_APPROVAL_REJECT into TARIFF_REJECT (confirmed OR'd duplicates of the same capability).
    actionCodes: [
      'TARIFF_CREATE', 'TARIFF_SUBMIT', 'TARIFF_EDIT', 'TARIFF_DEACTIVATE', 'TARIFF_REACTIVATE',
      'TARIFF_DEPRECATE', 'TARIFF_NEW_VERSION', 'TARIFF_VIEW', 'TARIFF_APPROVE', 'TARIFF_REJECT',
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
    // BILLING_CYCLE_APPROVAL_VIEW/APPROVE/REJECT folded into VIEW_BILLING_CYCLE/BILLING_CYCLE_APPROVE/
    // BILLING_CYCLE_REJECT respectively (confirmed OR'd duplicates of the same capability).
    // EXPORT_BILLING_CYCLE retired — no export route or service method ever existed (RBAC cleanup
    // audit); see 1793100000000-RetireDeadActionCodes.ts.
    actionCodes: [
      'CREATE_BILLING_CYCLE', 'BILLING_CYCLE_RESUBMIT', 'BILLING_CYCLE_NEW_VERSION',
      'BILLING_CYCLE_DEPRECATE', 'VIEW_BILLING_CYCLE', 'BILLING_CYCLE_APPROVE',
      'BILLING_CYCLE_REJECT',
    ],
  },
  {
    code: 'BILL_RUN',
    // Confirmed via the Policy editor/sidebar mismatch audit: this ONE resource backs TWO distinct
    // sidebar screens under two different modules — Billing Management's "Bill Run Register"
    // (BILL_RUN_VIEW/SUBMIT/APPROVE) and Meter Management's "Billing Readiness"
    // (BILLING_READINESS_VIEW) — so "Bill Runs" alone left admins unable to find the resource that
    // actually grants the Billing Readiness screen. Renamed to name both; the underlying code/
    // actionCodes are unchanged, each individually still gated by its own existing action.
    name: 'Bill Runs & Billing Readiness',
    description: 'Bill run submission, review, and approval — also covers the Billing Readiness screen\'s own view action (BILLING_READINESS_VIEW)',
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
    // REGISTRATION_APPROVAL_VIEW/APPROVE/REJECT folded into VIEW_REGISTRATION_REQUESTS/
    // APPROVE_REGISTRATION_REQUEST/REJECT_REGISTRATION_REQUEST (confirmed OR'd duplicates of the
    // same capability). REGISTRATION_APPROVAL_DEPOSIT_MANAGE is NOT a duplicate — it's a distinct,
    // narrower capability already OR'd *alongside* (not instead of) EDIT_REGISTRATION_REQUEST, kept.
    actionCodes: [
      'VIEW_REGISTRATION_REQUESTS', 'CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST',
      'APPROVE_REGISTRATION_REQUEST', 'REJECT_REGISTRATION_REQUEST',
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
    // Matches the sidebar's own "Meter Information" label exactly (was "Meters" — confirmed via the
    // Policy editor/sidebar mismatch audit as a genuine display-label mismatch: admins looking for
    // the resource backing the Meter Information screen couldn't find it under that name). Also
    // backs Daily Meter Readings' own view (METER_VIEW, reused across both screens) and Import
    // Center's import flow (METER_IMPORT) — see METER_VIEW's own seed-data.ts comment.
    name: 'Meter Information',
    description: 'Meter Information and Daily Meter Readings viewing, plus meter import/export/mapping (collapsed from several duplicate-code screens)',
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
    // Deliberately NOT "Meter Readings" (confirmed via the Policy editor/sidebar mismatch audit as a
    // confusing near-duplicate of "Meter Information," which is what actually grants VIEWING the
    // Daily Meter Readings screen via METER_VIEW) — this resource's one action only lets a role
    // approve/revoke individual readings, never view them on its own.
    name: 'Meter Reading Approvals',
    description: 'Approve or revoke approval of individual/bulk meter readings on the Daily Meter Readings screen — granting this alone does not grant viewing that screen; see Meter Information\'s METER_VIEW action for that',
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

/** The five deliberately nav-visibility-only Action codes (see this file's own top comment) that
 *  intentionally have NO entry anywhere in RESOURCES above — Policy/Resource administration is
 *  gated by the unchanged `@Roles(SUPER_ADMIN)` check, independent of whether a role holds these
 *  codes, so a Policy statement granting one of them would be meaningless/circular. Exported as the
 *  single shared source of truth for "is this code expected to have no Resource mapping" — used by
 *  both the static resource-catalog correctness tests and any migration/script that needs to tell
 *  apart a genuine mapping gap (a real bug) from one of these five intentional exceptions. */
export const NAV_ONLY_ACTION_CODES = new Set([
  'VIEW_POLICY',
  'CREATE_POLICY',
  'EDIT_POLICY',
  'DELETE_POLICY',
  'VIEW_RESOURCE',
]);

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
