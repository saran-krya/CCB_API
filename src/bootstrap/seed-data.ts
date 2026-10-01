
export interface SeedPModule {
  moduleName: string
  code: string
  type: 'MENU' | 'PAGE'
  icon?: string
  url?: string
  displayOrder: number
}

export interface SeedSubModule {
  pModuleCode: string
  name: string
  code: string
  icon?: string
  url?: string
  displayOrder: number
}

export interface SeedScreen {
  subModuleCode?: string
  pModuleCode?: string
  name: string
  code: string
  url?: string
  displayOrder: number
}

export interface SeedAction {
  screenCode: string
  name: string
  code: string
  description?: string
  parentActionCode?: string 
  displayOrder?: number 
}

export interface SeedRole {
  roleName: string
  roleDescription: string
  userCategoryName: string
  canBeReportingManager: boolean
}

export interface SeedRegistrationDocumentRule {
  documentType: string
  level: 'Identity' | 'Account' | 'Unit' | 'Payment'
  appliesToResident: 'Owner' | 'Tenant' | 'Both'
  appliesToAccount: 'Individual' | 'Corporate' | 'Both'
  appliesToContactType: 'Self' | 'Authorized Representative' | 'Manager on License' | 'Any'
  requirement: 'Mandatory' | 'Optional' | 'Not Applicable'
  displayOrder: number
}


export const PMODULES: SeedPModule[] = [
  {
    moduleName: 'Dashboard',
    code: 'DASHBOARD',
    type: 'PAGE',
    icon: 'LayoutDashboard',
    url: '/',
    displayOrder: 1,
  },
  {
    moduleName: 'Community Management',
    code: 'COMMUNITY_MANAGEMENT',
    type: 'PAGE',
    icon: 'Building2',
    url: '/communities',
    displayOrder: 2,
  },
  {
    moduleName: 'Customer Management',
    code: 'CUSTOMER_MANAGEMENT',
    type: 'MENU',
    icon: 'Users',
    displayOrder: 3,
  },
  {
    moduleName: 'Meter Management',
    code: 'METER_MANAGEMENT',
    type: 'MENU',
    icon: 'Activity',
    displayOrder: 4,
  },
  {
    moduleName: 'Billing Management',
    code: 'BILLING_MANAGEMENT',
    type: 'MENU',
    icon: 'Receipt',
    displayOrder: 5,
  },
  {
    moduleName: 'System Admin',
    code: 'SYSTEM_ADMIN',
    type: 'MENU',
    icon: 'Server',
    displayOrder: 99,
  },
  {
    moduleName: 'Business Admin',
    code: 'BUSINESS_ADMIN',
    type: 'MENU',
    icon: 'Briefcase',
    displayOrder: 100,
  },
  {
    moduleName: 'Finance',
    code: 'FINANCE',
    type: 'MENU',
    icon: 'DollarSign',
    displayOrder: 101,
  },
]


export const SUB_MODULES: SeedSubModule[] = [
  {
    pModuleCode: 'CUSTOMER_MANAGEMENT',
    name: 'Customer List',
    code: 'CUSTOMER_LIST',
    icon: 'Users',
    url: '/customers',
    displayOrder: 1,
  },
  {
    pModuleCode: 'CUSTOMER_MANAGEMENT',
    name: 'Registration Requests',
    code: 'REGISTRATION_REQUESTS',
    icon: 'UserPlus',
    url: '/customers/registration-requests',
    displayOrder: 2,
  },
  {
    pModuleCode: 'CUSTOMER_MANAGEMENT',
    name: 'Service Requests & Tickets',
    code: 'SERVICE_REQUESTS_TICKETS',
    icon: 'Ticket',
    url: '/customers/tickets',
    displayOrder: 3,
  },
  {
    pModuleCode: 'CUSTOMER_MANAGEMENT',
    name: 'Registration Approval',
    code: 'REGISTRATION_APPROVAL',
    icon: 'ShieldCheck',
    url: '/customers/registration-approval',
    displayOrder: 4,
  },

  {
    pModuleCode: 'METER_MANAGEMENT',
    name: 'Meter Information',
    code: 'METER_LIST',
    icon: 'Activity',
    url: '/meters',
    displayOrder: 1,
  },
  {
    pModuleCode: 'METER_MANAGEMENT',
    name: 'Import Center',
    code: 'IMPORT_CENTER',
    icon: 'Upload',
    url: '/meters/import-center',
    displayOrder: 2,
  },
  {
    pModuleCode: 'METER_MANAGEMENT',
    name: 'SFTP File Monitor',
    code: 'SFTP_MONITOR',
    icon: 'FolderSync',
    url: '/meters/sftp-monitor',
    displayOrder: 3,
  },
  {
    pModuleCode: 'METER_MANAGEMENT',
    name: 'Daily Meter Readings',
    code: 'DAILY_METER_READINGS',
    icon: 'BarChart2',
    url: '/meters/daily-meter-readings',
    displayOrder: 4,
  },
  {
    pModuleCode: 'METER_MANAGEMENT',
    name: 'Billing Readiness',
    code: 'BILLING_READINESS',
    icon: 'BadgeCheck',
    url: '/meters/billing-readiness',
    displayOrder: 5,
  },
  {
    pModuleCode: 'METER_MANAGEMENT',
    name: 'Meter Inventory',
    code: 'METER_INVENTORY',
    icon: 'Gauge',
    url: '/meters/inventory',
    displayOrder: 6,
  },

  {
    pModuleCode: 'BILLING_MANAGEMENT',
    name: 'Billing Dashboard',
    code: 'BILLING_DASHBOARD',
    icon: 'TrendingUp',
    url: '/billing',
    displayOrder: 1,
  },
  {
    pModuleCode: 'BILLING_MANAGEMENT',
    name: 'Generate Bills',
    code: 'GENERATE_BILLS',
    icon: 'FileText',
    url: '/billing/generate',
    displayOrder: 2,
  },
  {
    pModuleCode: 'BILLING_MANAGEMENT',
    name: 'Bill Register',
    code: 'BILL_REGISTER',
    icon: 'CheckCircle2',
    url: '/billing/register',
    displayOrder: 3,
  },
  {
    pModuleCode: 'BILLING_MANAGEMENT',
    name: 'Manage Invoices',
    code: 'MANAGE_INVOICES',
    icon: 'Paperclip',
    url: '/billing/invoices',
    displayOrder: 4,
  },
  {
    pModuleCode: 'BILLING_MANAGEMENT',
    name: 'Payments',
    code: 'PAYMENTS',
    icon: 'DollarSign',
    url: '/billing/payments',
    displayOrder: 5,
  },
  // Added when Finance review of Bill Run Requests was relocated here from Meter Management →
  // Billing Readiness (which stays view-only — see BILLING_READINESS_BILL_RUN's own comment).
  // Reuses the SAME screen/actions (BILLING_READINESS_BILL_RUN / BILL_RUN_VIEW/SUBMIT/APPROVE) —
  // an Action belongs to exactly one Screen (see action.entity.ts's single screenId FK), so this is
  // a genuine re-home of the existing screen's subModuleCode, not a duplicate RBAC tree. No new
  // action/permission codes were introduced for this move.
  {
    pModuleCode: 'BILLING_MANAGEMENT',
    name: 'Bill Run Register',
    code: 'BILL_RUN_REGISTER',
    icon: 'ClipboardCheck',
    url: '/billing/bill-run-register',
    displayOrder: 6,
  },

  {
    pModuleCode: 'SYSTEM_ADMIN',
    name: 'User Mangement',
    code: 'USER_MANAGEMENT',
    icon: 'UserCog',
    displayOrder: 1,
  },
  {
    pModuleCode: 'SYSTEM_ADMIN',
    name: 'Role Management',
    code: 'ROLE_MANAGEMENT',
    icon: 'KeyRound',
    url: '/admin/system/roles',
    displayOrder: 2,
  },
  {
    pModuleCode: 'SYSTEM_ADMIN',
    name: 'Attributes',
    code: 'ATTRIBUTES',
    icon: 'SlidersHorizontal',
    displayOrder: 3,
  },
  {
    pModuleCode: 'SYSTEM_ADMIN',
    name: 'Lookup Field Master',
    code: 'LFM',
    icon: 'ListChecks',
    displayOrder: 4,
  },
  {
    pModuleCode: 'SYSTEM_ADMIN',
    name: 'Document Set Definition',
    code: 'DOCUMENT_SET_DEFINITION',
    icon: 'FileCheck2',
    displayOrder: 5,
  },

  {
    pModuleCode: 'BUSINESS_ADMIN',
    name: 'Tariff Configuration',
    code: 'TARIFF_CONFIG',
    icon: 'Tag',
    displayOrder: 1,
  },
  {
    pModuleCode: 'BUSINESS_ADMIN',
    name: 'Billing Cycle Configuration',
    code: 'BILLING_CYCLE_CONFIG',
    icon: 'CalendarRange',
    displayOrder: 2,
  },
  // Centralized, READ-ONLY approval visibility/queue over Tariff + Bill Run (Billing Cycle
  // deliberately excluded this phase — it keeps its own existing Finance approval screen,
  // untouched). Workflow performs no approve/reject/return mutation of its own — every item links
  // back to its real, authoritative domain screen (Tariff Approval / Bill Run Register) to act.
  {
    pModuleCode: 'BUSINESS_ADMIN',
    name: 'Workflow',
    code: 'WORKFLOW',
    icon: 'GitBranch',
    displayOrder: 3,
  },
  {
    pModuleCode: 'FINANCE',
    name: 'Tariff Approval',
    code: 'TARIFF_APPROVAL',
    icon: 'BadgeCheck',
    displayOrder: 1,
  },
  {
    pModuleCode: 'FINANCE',
    name: 'Billing Cycle Approval',
    code: 'BILLING_CYCLE_APPROVAL',
    icon: 'CalendarCheck',
    displayOrder: 2,
  },
]


export const SCREENS: SeedScreen[] = [
  {
    subModuleCode: 'USER_MANAGEMENT',
    name: 'Userslist',
    code: 'USER_LIST',
    url: '/admin/system/users',
    displayOrder: 1,
  },
  {
    subModuleCode: 'ROLE_MANAGEMENT',
    name: 'Roles',
    code: 'ROLE',
    url: '/admin/system/roles',
    displayOrder: 1,
  },
  {
    subModuleCode: 'ATTRIBUTES',
    name: 'Attributes',
    code: 'ATTRIBUTES',
    url: '/admin/system/attributes',
    displayOrder: 1,
  },
  {
    subModuleCode: 'LFM',
    name: 'Lookup Field Master',
    code: 'LFM',
    url: '/admin/system/lov-master',
    displayOrder: 1,
  },
  {
    subModuleCode: 'DOCUMENT_SET_DEFINITION',
    name: 'Document Set Definition',
    code: 'DOCUMENT_SET_DEFINITION',
    url: '/admin/system/document-set-definition',
    displayOrder: 1,
  },

  {
    subModuleCode: 'TARIFF_CONFIG',
    name: 'Tariff Configuration',
    code: 'TARIFF_CONFIG',
    url: '/admin/business/tariff-config',
    displayOrder: 1,
  },
  {
    subModuleCode: 'WORKFLOW',
    name: 'Workflow',
    code: 'WORKFLOW',
    url: '/admin/business/workflow',
    displayOrder: 1,
  },
  {
    subModuleCode: 'TARIFF_APPROVAL',
    name: 'Tariff Approval',
    code: 'TARIFF_APPROVAL',
    url: '/finance/tariff-approval',
    displayOrder: 1,
  },
  {
    subModuleCode: 'BILLING_CYCLE_APPROVAL',
    name: 'Billing Cycle Approval',
    code: 'BILLING_CYCLE_APPROVAL',
    url: '/finance/billing-cycle-approval',
    displayOrder: 1,
  },
  {
    subModuleCode: 'BILLING_CYCLE_CONFIG',
    name: 'Billing Cycle Configuration',
    code: 'BILLING_CYCLE',
    url: '/admin/business/billing-cycle',
    displayOrder: 1,
  },

  {
    pModuleCode: 'COMMUNITY_MANAGEMENT',
    name: 'Community',
    code: 'COMMUNITY',
    url: '/communities',
    displayOrder: 1,
  },
  {
    pModuleCode: 'COMMUNITY_MANAGEMENT',
    name: 'Property',
    code: 'PROPERTY',
    displayOrder: 2,
  },
  {
    pModuleCode: 'COMMUNITY_MANAGEMENT',
    name: 'Unit',
    code: 'UNIT',
    displayOrder: 3,
  },

  {
    subModuleCode: 'CUSTOMER_LIST',
    name: 'Customer',
    code: 'CUSTOMER',
    url: '/customers',
    displayOrder: 1,
  },
  {
    subModuleCode: 'REGISTRATION_REQUESTS',
    name: 'Registration Requests',
    code: 'REGISTRATION_REQUESTS',
    url: '/customers/registration-requests',
    displayOrder: 1,
  },
  {
    subModuleCode: 'SERVICE_REQUESTS_TICKETS',
    name: 'Service Requests & Tickets',
    code: 'SERVICE_REQUESTS_TICKETS',
    url: '/customers/tickets',
    displayOrder: 1,
  },
  {
    subModuleCode: 'REGISTRATION_APPROVAL',
    name: 'Registration Approval',
    code: 'REGISTRATION_APPROVAL',
    url: '/customers/registration-approval',
    displayOrder: 1,
  },

  {
    subModuleCode: 'METER_LIST',
    name: 'Meter Information',
    code: 'METER_LIST',
    url: '/meters',
    displayOrder: 1,
  },
  {
    subModuleCode: 'IMPORT_CENTER',
    name: 'Import Center',
    code: 'IMPORT_CENTER',
    url: '/meters/import-center',
    displayOrder: 1,
  },
  {
    subModuleCode: 'SFTP_MONITOR',
    name: 'SFTP File Monitor',
    code: 'SFTP_MONITOR',
    url: '/meters/sftp-monitor',
    displayOrder: 1,
  },
  // Billing Readiness's 4 product TABS (Dashboard, Property Billing Readiness, Anomaly Review,
  // Readings List) are UI navigation only — the RBAC boundary is this ONE screen, matching the
  // sub-module 1:1 exactly like Meter Information (METER_LIST screen == METER_LIST sub-module).
  // The screen holds exactly ONE action, BILLING_READINESS_VIEW (see that action's own comment) —
  // holding it grants every tab; none of the 4 tabs has, or should have, its own permission. A prior
  // version of this file gave each tab its own bare Screen row "for visibility" (including two with
  // zero actions — a real structural landmine, see git history), then a later version split viewing
  // into two separate actions (Dashboard vs. Property) before merging back to one on explicit
  // request. Tab visibility is derived from this single action grant in
  // useBillingReadinessTabAccess.ts, never from a per-tab screen or a per-tab permission.
  {
    subModuleCode: 'BILLING_READINESS',
    name: 'Billing Readiness',
    code: 'BILLING_READINESS',
    url: '/meters/billing-readiness',
    displayOrder: 1,
  },
  // Finance's actual review/approve/reject/return workflow for this screen now lives at
  // /billing/bill-run-register (Billing Management → Bill Run Register — see the BILL_RUN_REGISTER
  // sub-module above). This screen row is re-homed there (real move — see the migration that
  // updates the already-live screen's sub_module_id, since ensureCriticalDefaults() only backfills
  // screens that don't exist yet and never retroactively moves an existing one).
  // /meters/billing-readiness/bill-run stays a real, visible tab (gated on the same BILL_RUN_VIEW
  // action), but is intentionally VIEW ONLY there — no Approve/Reject/Return/Resubmit UI renders on
  // that tab regardless of the viewer's BILL_RUN_APPROVE grant. This is a UI-only simplification,
  // not a security boundary: the backend enforces via the same @Permission('BILL_RUN_APPROVE')
  // guard wherever it's called from, so nothing here weakens backend authorization.
  {
    subModuleCode: 'BILL_RUN_REGISTER',
    name: 'Bill Run Register',
    code: 'BILLING_READINESS_BILL_RUN',
    url: '/billing/bill-run-register',
    displayOrder: 1,
  },
  {
    subModuleCode: 'METER_INVENTORY',
    name: 'Meter Inventory',
    code: 'METER_INVENTORY',
    url: '/meters/inventory',
    displayOrder: 1,
  },
  // BILL_REGISTER is one of 5 sub-modules already reserved under the BILLING_MANAGEMENT module
  // (pmodule + these 5 sub-modules existed in this seed data before any Billing Management
  // implementation — real, pre-planned RBAC scaffolding, not newly invented here). Only this one
  // screen is populated for Phase 1-2 (the real Bills list) — GENERATE_BILLS/BILLING_DASHBOARD/
  // MANAGE_INVOICES/PAYMENTS stay bare (zero screens) until a later phase actually needs them; see
  // this feature's own design doc for why "Generate Bills" as a manual-trigger screen was
  // deliberately NOT built (generation is a consequence of Bill Run approval, never a standalone
  // user action).
  {
    subModuleCode: 'BILL_REGISTER',
    name: 'Bill Register',
    code: 'BILL_REGISTER_SCREEN',
    url: '/billing/register',
    displayOrder: 1,
  },
]


export const ACTIONS: SeedAction[] = [
  {
    screenCode: 'USER_LIST',
    name: 'View Users',
    code: 'VIEW_USER',
    description: 'View the user list',
  },
  {
    screenCode: 'USER_LIST',
    name: 'View User Overview',
    code: 'USER_OVERVIEW',
    description: 'Navigate to the user overview / detail page',
  },
  {
    screenCode: 'USER_LIST',
    name: 'Create User',
    code: 'CREATE_USER',
    description: 'Access the create-user form',
  },
  {
    screenCode: 'USER_LIST',
    name: 'Edit User',
    code: 'EDIT_USER',
    description: 'Access the edit-user form',
  },
  {
    screenCode: 'USER_LIST',
    name: 'Delete User',
    code: 'DELETE_USER',
    description: 'Delete a user',
  },

  {
    screenCode: 'ROLE',
    name: 'View Roles',
    code: 'VIEW_ROLE',
    description: 'View the role list',
  },
  {
    screenCode: 'ROLE',
    name: 'Create Role',
    code: 'CREATE_ROLE',
    description: 'Access the create-role form',
  },
  {
    screenCode: 'ROLE',
    name: 'Edit Role',
    code: 'EDIT_ROLE',
    description: 'Access the edit-role and permissions form',
  },
  {
    screenCode: 'ROLE',
    name: 'Delete Role',
    code: 'DELETE_ROLE',
    description: 'Delete a role',
  },

  {
    screenCode: 'ATTRIBUTES',
    name: 'View Attribute',
    code: 'VIEW_ATTRIBUTE',
    description: 'View system and module attributes',
  },
  {
    screenCode: 'ATTRIBUTES',
    name: 'Create Attribute',
    code: 'CREATE_ATTRIBUTE',
    description: 'Add a new custom attribute',
  },
  {
    screenCode: 'ATTRIBUTES',
    name: 'Edit Attribute',
    code: 'EDIT_ATTRIBUTE',
    description: 'Change an attribute value',
  },
  {
    screenCode: 'ATTRIBUTES',
    name: 'Delete Attribute',
    code: 'DELETE_ATTRIBUTE',
    description: 'Remove a custom (non-system-defined) attribute',
  },

  {
    screenCode: 'TARIFF_CONFIG',
    name: 'Create Tariff',
    code: 'TARIFF_CREATE',
    description: 'Access the create-tariff workflow',
    displayOrder: 1,
  },
  {
    screenCode: 'TARIFF_CONFIG',
    name: 'Submit Tariff',
    code: 'TARIFF_SUBMIT',
    description: 'Submit or resubmit a tariff for Finance approval',
    parentActionCode: 'TARIFF_CREATE',
    displayOrder: 1,
  },
  {
    screenCode: 'TARIFF_CONFIG',
    name: 'Edit Tariff',
    code: 'TARIFF_EDIT',
    description: 'Edit an editable tariff version',
    displayOrder: 2,
  },
  {
    screenCode: 'TARIFF_CONFIG',
    name: 'Deactivate Tariff',
    code: 'TARIFF_DEACTIVATE',
    description: 'Deactivate an active tariff',
    parentActionCode: 'TARIFF_EDIT',
    displayOrder: 1,
  },
  {
    screenCode: 'TARIFF_CONFIG',
    name: 'Reactivate Tariff',
    code: 'TARIFF_REACTIVATE',
    description: 'Reactivate an inactive tariff',
    parentActionCode: 'TARIFF_EDIT',
    displayOrder: 2,
  },
  {
    screenCode: 'TARIFF_CONFIG',
    name: 'Deprecate Tariff',
    code: 'TARIFF_DEPRECATE',
    description: 'Permanently deprecate a tariff version',
    parentActionCode: 'TARIFF_EDIT',
    displayOrder: 3,
  },
  {
    screenCode: 'TARIFF_CONFIG',
    name: 'Create New Tariff Version',
    code: 'TARIFF_NEW_VERSION',
    description: 'Clone an active tariff into a new editable version',
    parentActionCode: 'TARIFF_EDIT',
    displayOrder: 4,
  },
  {
    screenCode: 'WORKFLOW',
    name: 'View Workflow',
    code: 'WORKFLOW_VIEW',
    description: 'View the centralized Workflow approval visibility/queue (Tariff + Bill Run) — read-only, no approve/reject/return action lives here',
    displayOrder: 1,
  },
  {
    screenCode: 'WORKFLOW',
    name: 'Manage Workflow Approvers',
    code: 'WORKFLOW_MANAGE_APPROVERS',
    description: 'Add or remove which roles may approve a Tariff or Bill Run — excluded from the SUPER_ADMIN/ADMIN auto-grant, same as TARIFF_APPROVE/BILL_RUN_APPROVE',
    parentActionCode: 'WORKFLOW_VIEW',
    displayOrder: 2,
  },
  {
    screenCode: 'TARIFF_CONFIG',
    name: 'View Tariff Detail',
    code: 'TARIFF_VIEW',
    description: 'View a tariff version detail page',
    displayOrder: 3,
  },
  {
    screenCode: 'TARIFF_CONFIG',
    name: 'Tariff Approval Queue',
    code: 'TARIFF_APPROVAL_QUEUE',
    description: 'Access the tariff pending-approval queue',
    parentActionCode: 'TARIFF_VIEW',
    displayOrder: 1,
  },
  {
    screenCode: 'TARIFF_CONFIG',
    name: 'Approve Tariff',
    code: 'TARIFF_APPROVE',
    description: 'Approve a pending tariff — Finance only, service-enforced regardless of this grant',
    parentActionCode: 'TARIFF_VIEW',
    displayOrder: 2,
  },
  {
    screenCode: 'TARIFF_CONFIG',
    name: 'Reject Tariff',
    code: 'TARIFF_REJECT',
    description: 'Reject a pending tariff — Finance only, service-enforced regardless of this grant',
    parentActionCode: 'TARIFF_VIEW',
    displayOrder: 3,
  },
  {
    screenCode: 'TARIFF_APPROVAL',
    name: 'View Tariff Approval Queue',
    code: 'TARIFF_APPROVAL_VIEW',
    description: 'Access the Finance Tariff Approval screen',
    displayOrder: 1,
  },
  {
    screenCode: 'TARIFF_APPROVAL',
    name: 'Approve Tariff (Finance)',
    code: 'TARIFF_APPROVAL_APPROVE',
    description: 'Approve a pending tariff from the Finance Tariff Approval screen — accepted as an alternate to TARIFF_APPROVE so Finance never depends on Business Admin access',
    parentActionCode: 'TARIFF_APPROVAL_VIEW',
    displayOrder: 2,
  },
  {
    screenCode: 'TARIFF_APPROVAL',
    name: 'Reject Tariff (Finance)',
    code: 'TARIFF_APPROVAL_REJECT',
    description: 'Reject a pending tariff from the Finance Tariff Approval screen — accepted as an alternate to TARIFF_REJECT so Finance never depends on Business Admin access',
    parentActionCode: 'TARIFF_APPROVAL_VIEW',
    displayOrder: 3,
  },

  {
    screenCode: 'BILLING_CYCLE',
    name: 'Create Billing Cycle',
    code: 'CREATE_BILLING_CYCLE',
    description: 'Access the create-billing-cycle form',
    displayOrder: 1,
  },
  {
    screenCode: 'BILLING_CYCLE',
    name: 'Resubmit Billing Cycle',
    code: 'BILLING_CYCLE_RESUBMIT',
    description: 'Resubmit a rejected billing cycle version for Finance approval',
    parentActionCode: 'CREATE_BILLING_CYCLE',
    displayOrder: 1,
  },
  {
    screenCode: 'BILLING_CYCLE',
    name: 'Create New Billing Cycle Version',
    code: 'BILLING_CYCLE_NEW_VERSION',
    description: 'Clone the current governing billing cycle into a new pending version',
    displayOrder: 2,
  },
  {
    screenCode: 'BILLING_CYCLE',
    name: 'Deprecate Billing Cycle',
    code: 'BILLING_CYCLE_DEPRECATE',
    description: 'Permanently deprecate a billing cycle version, immediately or on a future date',
    displayOrder: 3,
  },
  {
    screenCode: 'BILLING_CYCLE',
    name: 'View Billing Cycle',
    code: 'VIEW_BILLING_CYCLE',
    description: 'View billing cycle list and detail pages',
    displayOrder: 4,
  },
  {
    screenCode: 'BILLING_CYCLE',
    name: 'Approve Billing Cycle',
    code: 'BILLING_CYCLE_APPROVE',
    description: 'Approve a pending billing cycle version — Finance only, service-enforced regardless of this grant',
    parentActionCode: 'VIEW_BILLING_CYCLE',
    displayOrder: 1,
  },
  {
    screenCode: 'BILLING_CYCLE',
    name: 'Reject Billing Cycle',
    code: 'BILLING_CYCLE_REJECT',
    description: 'Reject a pending billing cycle version — Finance only, service-enforced regardless of this grant',
    parentActionCode: 'VIEW_BILLING_CYCLE',
    displayOrder: 2,
  },
  {
    screenCode: 'BILLING_CYCLE',
    name: 'Export Billing Cycles',
    code: 'EXPORT_BILLING_CYCLE',
    description: 'Export the billing cycle list',
    displayOrder: 5,
  },
  {
    screenCode: 'BILLING_CYCLE_APPROVAL',
    name: 'View Billing Cycle Approval Queue',
    code: 'BILLING_CYCLE_APPROVAL_VIEW',
    description: 'Access the Finance Billing Cycle Approval screen',
    displayOrder: 1,
  },
  {
    screenCode: 'BILLING_CYCLE_APPROVAL',
    name: 'Approve Billing Cycle (Finance)',
    code: 'BILLING_CYCLE_APPROVAL_APPROVE',
    description: 'Approve a pending billing cycle version from the Finance Billing Cycle Approval screen — accepted as an alternate to BILLING_CYCLE_APPROVE so Finance never depends on Business Admin access',
    parentActionCode: 'BILLING_CYCLE_APPROVAL_VIEW',
    displayOrder: 2,
  },
  {
    screenCode: 'BILLING_CYCLE_APPROVAL',
    name: 'Reject Billing Cycle (Finance)',
    code: 'BILLING_CYCLE_APPROVAL_REJECT',
    description: 'Reject a pending billing cycle version from the Finance Billing Cycle Approval screen — accepted as an alternate to BILLING_CYCLE_REJECT so Finance never depends on Business Admin access',
    parentActionCode: 'BILLING_CYCLE_APPROVAL_VIEW',
    displayOrder: 3,
  },

  // BILL_RUN_VIEW/APPROVE live on BILLING_READINESS_BILL_RUN (nested under Billing Management's
  // BILL_RUN_REGISTER sub-module) — Finance's review/approve UI. BILL_RUN_SUBMIT ("Run Billing")
  // is deliberately attached to the BILLING_READINESS screen instead, as a sibling of
  // BILLING_READINESS_VIEW (see that action's own comment) — explicit request that "Run Billing"
  // appear under Meter Management → Billing Readiness in the Roles UI, not under Billing
  // Management. No parentActionCode: it's a sibling of View, not nested under it (matching the
  // target Billing Readiness -> {View, Run Billing} sibling structure, not a parent/child pair —
  // ActionsService.assertValidParent requires a parent/child pair share one screen, and View/Run
  // Billing intentionally do NOT share a screen with BILL_RUN_VIEW/APPROVE).
  {
    screenCode: 'BILLING_READINESS_BILL_RUN',
    name: 'View Bill Run',
    code: 'BILL_RUN_VIEW',
    description: 'View bill run requests, their pre-bill validation, and status history',
    displayOrder: 10,
  },
  {
    screenCode: 'BILLING_READINESS',
    name: 'Run Billing',
    code: 'BILL_RUN_SUBMIT',
    description: 'Submit an individual or batch bill run request, and correct/resubmit a returned one',
    displayOrder: 2,
  },
  {
    screenCode: 'BILLING_READINESS_BILL_RUN',
    name: 'Approve Bill Run',
    code: 'BILL_RUN_APPROVE',
    description: 'Approve, reject, or return a pending bill run request — intended for Finance roles; grant only to roles that should review bill runs',
    parentActionCode: 'BILL_RUN_VIEW',
    displayOrder: 2,
  },

  {
    screenCode: 'COMMUNITY',
    name: 'View Community',
    code: 'VIEW_COMMUNITY',
    description: 'View community list and detail pages',
  },
  {
    screenCode: 'COMMUNITY',
    name: 'Create Community',
    code: 'CREATE_COMMUNITY',
    description: 'Access the create-community form',
  },
  {
    screenCode: 'COMMUNITY',
    name: 'Edit Community',
    code: 'EDIT_COMMUNITY',
    description: 'Access the edit-community form',
  },
  {
    screenCode: 'COMMUNITY',
    name: 'Delete Community',
    code: 'DELETE_COMMUNITY',
    description: 'Delete a community',
  },
  {
    screenCode: 'COMMUNITY',
    name: 'Change Community Status',
    code: 'COMMUNITY_STATUS',
    description: 'Activate or deactivate a community',
  },

  {
    screenCode: 'PROPERTY',
    name: 'View Property',
    code: 'VIEW_PROPERTY',
    description: 'View property detail within a community',
  },
  {
    screenCode: 'PROPERTY',
    name: 'Create Property',
    code: 'CREATE_PROPERTY',
    description: 'Access the create-property form',
  },
  {
    screenCode: 'PROPERTY',
    name: 'Edit Property',
    code: 'EDIT_PROPERTY',
    description: 'Access the edit-property form',
  },
  {
    screenCode: 'PROPERTY',
    name: 'Delete Property',
    code: 'DELETE_PROPERTY',
    description: 'Delete a property',
  },
  {
    screenCode: 'PROPERTY',
    name: 'Change Property Status',
    code: 'PROPERTY_STATUS',
    description: 'Activate or deactivate a property',
  },

  {
    screenCode: 'UNIT',
    name: 'View Unit',
    code: 'VIEW_UNIT',
    description: 'View unit detail within a property',
  },
  {
    screenCode: 'UNIT',
    name: 'Create Unit',
    code: 'CREATE_UNIT',
    description: 'Access the create-unit form',
  },
  {
    screenCode: 'UNIT',
    name: 'Edit Unit',
    code: 'EDIT_UNIT',
    description: 'Access the edit-unit form',
  },
  {
    screenCode: 'UNIT',
    name: 'Delete Unit',
    code: 'DELETE_UNIT',
    description: 'Delete a unit',
  },
  {
    screenCode: 'UNIT',
    name: 'Change Unit Occupancy',
    code: 'UNIT_OCCUPANCY',
    description: 'Change a unit\'s occupancy status',
  },

  {
    screenCode: 'CUSTOMER',
    name: 'View Customer',
    code: 'VIEW_CUSTOMER',
    description: 'View customer detail, profile, and meter readings',
  },
  {
    screenCode: 'CUSTOMER',
    name: 'Create Customer',
    code: 'CREATE_CUSTOMER',
    description: 'Access the create-customer form',
  },
  {
    screenCode: 'CUSTOMER',
    name: 'Edit Customer',
    code: 'EDIT_CUSTOMER',
    description: 'Access the edit-customer form',
  },
  {
    screenCode: 'CUSTOMER',
    name: 'Delete Customer',
    code: 'DELETE_CUSTOMER',
    description: 'Delete a customer',
  },

  {
    screenCode: 'REGISTRATION_REQUESTS',
    name: 'View Registration Requests',
    code: 'VIEW_REGISTRATION_REQUESTS',
    description: 'View customer registration requests',
  },
  {
    screenCode: 'REGISTRATION_REQUESTS',
    name: 'Create Registration Request',
    code: 'CREATE_REGISTRATION_REQUEST',
    description: 'Create/save a registration draft, send it to the resident, and upload documents',
  },
  {
    screenCode: 'REGISTRATION_REQUESTS',
    name: 'Edit Registration Request',
    code: 'EDIT_REGISTRATION_REQUEST',
    description: 'Return for correction, request/verify the security deposit, and submit for approval',
  },
  {
    screenCode: 'REGISTRATION_REQUESTS',
    name: 'Approve Registration Request',
    code: 'APPROVE_REGISTRATION_REQUEST',
    description: 'Approve a registration request, creating the Customer record',
  },
  {
    screenCode: 'REGISTRATION_REQUESTS',
    name: 'Reject Registration Request',
    code: 'REJECT_REGISTRATION_REQUEST',
    description: 'Reject a registration request',
  },

  {
    screenCode: 'SERVICE_REQUESTS_TICKETS',
    name: 'View Service Requests & Tickets',
    code: 'VIEW_SERVICE_REQUESTS_TICKETS',
    description: 'View customer service requests and support tickets',
  },

  {
    screenCode: 'REGISTRATION_APPROVAL',
    name: 'View Registration Approval Queue',
    code: 'REGISTRATION_APPROVAL_VIEW',
    description: 'Access the Registration Approval queue — every submitted registration request awaiting review',
    displayOrder: 1,
  },
  {
    screenCode: 'REGISTRATION_APPROVAL',
    name: 'Approve Registration Request (Registration Approval)',
    code: 'REGISTRATION_APPROVAL_APPROVE',
    description: 'Approve a registration request from the Registration Approval screen — accepted as an alternate to APPROVE_REGISTRATION_REQUEST, the same underlying approve action',
    parentActionCode: 'REGISTRATION_APPROVAL_VIEW',
    displayOrder: 2,
  },
  {
    screenCode: 'REGISTRATION_APPROVAL',
    name: 'Reject Registration Request (Registration Approval)',
    code: 'REGISTRATION_APPROVAL_REJECT',
    description: 'Reject a registration request from the Registration Approval screen — accepted as an alternate to REJECT_REGISTRATION_REQUEST, the same underlying reject action',
    parentActionCode: 'REGISTRATION_APPROVAL_VIEW',
    displayOrder: 3,
  },

  {
    screenCode: 'DOCUMENT_SET_DEFINITION',
    name: 'View Document Set Definition',
    code: 'VIEW_REGISTRATION_DOCUMENT_RULES',
    description: 'View which documents the registration wizard requires per resident/account/contact-type combination',
  },
  {
    screenCode: 'DOCUMENT_SET_DEFINITION',
    name: 'Edit Document Set Definition',
    code: 'EDIT_REGISTRATION_DOCUMENT_RULES',
    description: 'Add, edit, or deactivate a registration document rule',
  },

  {
    screenCode: 'LFM',
    name: 'View LOV',
    code: 'LOV_VIEW',
    description: 'View lookup categories and values',
  },
  {
    screenCode: 'LFM',
    name: 'Create LOV Value',
    code: 'LOV_CREATE',
    description: 'Add a new lookup value',
  },
  {
    screenCode: 'LFM',
    name: 'Edit LOV Value',
    code: 'LOV_EDIT',
    description: 'Edit an existing lookup value',
  },
  {
    screenCode: 'LFM',
    name: 'Delete LOV Value',
    code: 'LOV_DELETE',
    description: 'Delete a lookup value',
  },
  {
    screenCode: 'LFM',
    name: 'Assign LOV Category Module',
    code: 'LOV_MODULE_ASSIGN',
    description: 'Reassign which module a lookup category belongs to',
  },

  {
    screenCode: 'METER_LIST',
    name: 'View Meter Information',
    code: 'METER_VIEW',
    description: 'View the meter dashboard, community/property/unit drill-down, master and sub meter lists',
    displayOrder: 1,
  },
  {
    screenCode: 'METER_LIST',
    name: 'Export Meters',
    code: 'METER_EXPORT',
    description: 'Export master or sub meters to Excel',
    parentActionCode: 'METER_VIEW',
    displayOrder: 1,
  },
  {
    screenCode: 'METER_LIST',
    name: 'Map Sub Meter',
    code: 'METER_MAPPING',
    description: 'Map, unmap, or change which unit a sub meter is mapped to',
    parentActionCode: 'METER_VIEW',
    displayOrder: 2,
  },
  {
    screenCode: 'METER_LIST',
    name: 'Register Meter',
    code: 'METER_CREATE',
    description: 'Register a new master or sub meter, individually or via bulk import',
    displayOrder: 2,
  },
  {
    screenCode: 'METER_LIST',
    name: 'Import Meters',
    code: 'METER_IMPORT',
    description: 'Bulk import master or sub meters from an Excel file',
    parentActionCode: 'METER_CREATE',
    displayOrder: 1,
  },

  {
    screenCode: 'METER_INVENTORY',
    name: 'View Meter Inventory',
    code: 'METER_INVENTORY_VIEW',
    description: 'View the Meter Inventory screen (Master Meter and Sub Meter lists)',
    displayOrder: 1,
  },
  {
    screenCode: 'METER_INVENTORY',
    name: 'Export Meter Inventory',
    code: 'METER_INVENTORY_EXPORT',
    description: 'Export Master or Sub Meters to Excel from the Meter Inventory screen',
    parentActionCode: 'METER_INVENTORY_VIEW',
    displayOrder: 1,
  },
  {
    screenCode: 'METER_INVENTORY',
    name: 'Register Meter (Inventory)',
    code: 'METER_INVENTORY_CREATE',
    description: 'Register a new Master or Sub Meter from the Meter Inventory screen',
    displayOrder: 2,
  },
  {
    screenCode: 'METER_INVENTORY',
    name: 'Edit Meter (Inventory)',
    code: 'METER_INVENTORY_EDIT',
    description: 'Edit a Master or Sub Meter, including status, from the Meter Inventory screen',
    displayOrder: 3,
  },
  {
    screenCode: 'METER_INVENTORY',
    name: 'Delete Meter (Inventory)',
    code: 'METER_INVENTORY_DELETE',
    description: 'Delete a Master or Sub Meter from the Meter Inventory screen (reserved — no hard-delete capability exists yet; not wired to any UI action)',
    displayOrder: 4,
  },

  {
    screenCode: 'IMPORT_CENTER',
    name: 'View Import Center',
    code: 'IMPORT_CENTER_VIEW',
    description: 'View the Import Center dashboard, template downloads, and bulk import history',
    displayOrder: 1,
  },

  {
    screenCode: 'SFTP_MONITOR',
    name: 'View SFTP File Monitor',
    code: 'SFTP_MONITOR_VIEW',
    description: 'View SFTP ingestion status, estate summary, file lists, and trigger/download/parse SFTP files',
    displayOrder: 1,
  },

  // BILLING_READINESS_VIEW is the SINGLE permission for the entire Billing Readiness sub-module —
  // explicit design decision: holding it grants every tab (Dashboard, Property Billing Readiness,
  // Anomaly Review, Readings List) as pure UI navigation, none of which has (or should have) its own
  // separate permission. This is the sole action attached to the one Billing Readiness screen (see
  // that screen's own seed comment on why tabs aren't modeled as separate screens either).
  // "Run Billing" is intentionally a SEPARATE action (BILL_RUN_SUBMIT, seeded on its own
  // screen/sub-module below) — it gates the actual Run Billing button/API distinctly from viewing.
  //
  // BILLING_READINESS_PROPERTY_VIEW previously existed as a second, independently-assignable
  // view-only action (one real endpoint accepted either code as an OR). Merged into
  // BILLING_READINESS_VIEW on explicit request — every role that held the property code also
  // already held this one (confirmed via a live grants audit before merging, so no role lost
  // access) — see the RemoveBillingReadinessPropertyView migration for the actual removal.
  {
    screenCode: 'BILLING_READINESS',
    name: 'View',
    code: 'BILLING_READINESS_VIEW',
    description: 'View the Billing Readiness sub-module — Dashboard, Property Billing Readiness, Anomaly Review, and Readings List all derive their visibility from this one permission',
    displayOrder: 1,
  },
  // Billing Management — Bill Register. The BILL_REGISTER_SCREEN frontend page has been
  // decommissioned (its Bill Run approval role was superseded by Bill Run Register — see
  // BILLING_READINESS_BILL_RUN's own comment — and its manual Issue step no longer exists: a Bill
  // is issued at generation time now, see BillingManagementService.generateOneBill). BILLING_VIEW/
  // BILLING_CANCEL are kept as real, dormant backend capabilities (no UI references them today) for
  // a future customer/invoice-facing screen to reuse without re-inventing this RBAC — per explicit
  // instruction not to delete a capability just because its current UI was removed. BILLING_ISSUE
  // was removed entirely (not kept dormant) since issuance is no longer a distinct action anywhere
  // in this architecture; its role_permissions grants were removed in the same change.
  {
    screenCode: 'BILL_REGISTER_SCREEN',
    name: 'View Bills',
    code: 'BILLING_VIEW',
    description: 'View generated Bills, their line items, and status',
    displayOrder: 1,
  },
  {
    screenCode: 'BILL_REGISTER_SCREEN',
    name: 'Cancel Bill',
    code: 'BILLING_CANCEL',
    description: 'Cancel a generated Bill',
    parentActionCode: 'BILLING_VIEW',
    displayOrder: 2,
  },
]


export const ADMIN_GRANT_EXCLUDED_ACTION_CODES = [
  'TARIFF_APPROVE',
  'TARIFF_REJECT',
  'BILLING_CYCLE_APPROVE',
  'BILLING_CYCLE_REJECT',
  'BILLING_CYCLE_APPROVAL_APPROVE',
  'BILLING_CYCLE_APPROVAL_REJECT',
  // Gates Approve/Reject/Return together (unlike Tariff/Billing Cycle's separate _APPROVE/_REJECT
  // codes) — excluded from the SUPER_ADMIN auto-grant for the same segregation-of-duties reason:
  // Finance review should require an explicit grant, not come bundled with full system access.
  'BILL_RUN_APPROVE',
  // Edits who ELSE holds TARIFF_APPROVE/TARIFF_APPROVAL_APPROVE/BILL_RUN_APPROVE — same
  // segregation-of-duties reasoning as those codes themselves: the power to grant approve access
  // should require an explicit grant, not come bundled with full system access.
  'WORKFLOW_MANAGE_APPROVERS',
]

export const ROLES: SeedRole[] = [
  {
    roleName: 'SUPER_ADMIN',
    roleDescription:
      'Full system access — all modules, all actions, all data, except where excluded by explicit business rule (see ADMIN_GRANT_EXCLUDED_ACTION_CODES).',
    userCategoryName: 'Internal',
    canBeReportingManager: false,
  },
  {
    roleName: 'FINANCE',
    roleDescription: 'Billing, invoicing, tariff approval, and payment operations',
    userCategoryName: 'Internal',
    canBeReportingManager: true,
  },
  {
    roleName: 'OPERATIONS',
    roleDescription:
      'Meter management, daily readings review, anomaly resolution, and billing readiness',
    userCategoryName: 'Internal',
    canBeReportingManager: true,
  },
  {
    roleName: 'CUSTOMER_SUPPORT',
    roleDescription:
      'Customer-facing support, reading enquiry resolution, and dispute handling',
    userCategoryName: 'Internal',
    canBeReportingManager: false,
  },
  {
    roleName: 'CUSTOMER_SERVICE_EXECUTIVE',
    roleDescription: 'Creates and manages customer registration requests',
    userCategoryName: 'Internal',
    canBeReportingManager: false,
  },
  {
    roleName: 'CUSTOMER_SERVICE_SUPERVISOR',
    roleDescription: 'Reviews and approves or rejects submitted registration requests',
    userCategoryName: 'Internal',
    canBeReportingManager: true,
  },
  {
    roleName: 'CUSTOMER',
    roleDescription: 'End-customer self-service portal access',
    userCategoryName: 'External',
    canBeReportingManager: false,
  },
]

// Document Set Definition ("Registration" set) — spec §8.3. Which documents the registration
// wizard's Account/Identity/Unit/Payment steps require, per resident/account/contact-type
// combination. Identity keyed with (documentType, appliesToResident, appliesToAccount,
// appliesToContactType) — Emirates ID intentionally appears twice (Mandatory for Tenant, Optional
// for Owner) since an owner may be a non-resident investor.
export const REGISTRATION_DOCUMENT_RULES: SeedRegistrationDocumentRule[] = [
  { documentType: 'Title Deed', level: 'Unit', appliesToResident: 'Owner', appliesToAccount: 'Both', appliesToContactType: 'Any', requirement: 'Mandatory', displayOrder: 1 },
  { documentType: 'Tenancy Contract', level: 'Unit', appliesToResident: 'Tenant', appliesToAccount: 'Both', appliesToContactType: 'Any', requirement: 'Mandatory', displayOrder: 2 },
  { documentType: 'Ejari', level: 'Unit', appliesToResident: 'Tenant', appliesToAccount: 'Both', appliesToContactType: 'Any', requirement: 'Optional', displayOrder: 3 },
  { documentType: 'Trade License', level: 'Account', appliesToResident: 'Both', appliesToAccount: 'Corporate', appliesToContactType: 'Any', requirement: 'Mandatory', displayOrder: 4 },
  { documentType: 'TRN Certificate', level: 'Account', appliesToResident: 'Both', appliesToAccount: 'Corporate', appliesToContactType: 'Any', requirement: 'Mandatory', displayOrder: 5 },
  { documentType: 'Passport', level: 'Identity', appliesToResident: 'Both', appliesToAccount: 'Both', appliesToContactType: 'Any', requirement: 'Mandatory', displayOrder: 6 },
  { documentType: 'Emirates ID', level: 'Identity', appliesToResident: 'Tenant', appliesToAccount: 'Both', appliesToContactType: 'Any', requirement: 'Mandatory', displayOrder: 7 },
  { documentType: 'Emirates ID', level: 'Identity', appliesToResident: 'Owner', appliesToAccount: 'Both', appliesToContactType: 'Any', requirement: 'Optional', displayOrder: 8 },
  { documentType: 'Power of Attorney', level: 'Identity', appliesToResident: 'Both', appliesToAccount: 'Both', appliesToContactType: 'Authorized Representative', requirement: 'Mandatory', displayOrder: 9 },
  { documentType: "Owner's Emirates ID", level: 'Identity', appliesToResident: 'Owner', appliesToAccount: 'Individual', appliesToContactType: 'Authorized Representative', requirement: 'Optional', displayOrder: 10 },
  { documentType: "Tenant's Emirates ID", level: 'Identity', appliesToResident: 'Tenant', appliesToAccount: 'Individual', appliesToContactType: 'Authorized Representative', requirement: 'Optional', displayOrder: 11 },
  { documentType: 'Payment Receipt', level: 'Payment', appliesToResident: 'Both', appliesToAccount: 'Both', appliesToContactType: 'Any', requirement: 'Mandatory', displayOrder: 12 },
  { documentType: 'Supporting Document', level: 'Payment', appliesToResident: 'Both', appliesToAccount: 'Both', appliesToContactType: 'Any', requirement: 'Optional', displayOrder: 13 },
]

// Terms & Conditions — default placeholder content for the registration wizard's Review & Submit
// step, seeded as the REGISTRATION_TERMS_AND_CONDITIONS Attribute (see attribute.service.ts's
// buildAttributeSeed, scope: SYSTEM). Editable thereafter via System Admin -> Attributes ->
// General Attributes; this constant exists purely so the wizard never renders an empty acceptance
// block on a fresh environment.
export const REGISTRATION_TERMS_AND_CONDITIONS_DEFAULT = [
  'The personal, unit, and payment details provided are accurate, and I am authorised to register the selected unit(s).',
  'I consent to the community management verifying my documents and contacting me on my chosen communication channel, and to being billed for district-cooling (BTU) consumption per the applicable tariff — including a refundable security deposit and any activation fee where applicable.',
  'I understand that submitting this registration request initiates a review by Customer Support and Business Admin, and that access to billing is granted only once the request is approved.',
].join('\n\n')
