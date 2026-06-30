/**
 * Static seed definitions for the bootstrap process.
 *
 * These are inserted once on first startup (fresh database).
 * All codes must stay in sync with the frontend ROUTE_CODE_MAP
 * in CCB_Platform/lib/constants/route-map.ts.
 */

export interface SeedUserCategory {
  name: string
  description: string
}

export interface SeedUserType {
  name: string
  description: string
}

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
  subModuleCode: string
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
}

export interface SeedRole {
  roleName: string
  roleDescription: string
  userCategoryName: string
  userTypeName: string
  canBeReportingManager: boolean
}

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

export const USER_CATEGORIES: SeedUserCategory[] = [
  {
    name: 'Internal',
    description: 'CCB internal staff, administrators, and operations team',
  },
  {
    name: 'External',
    description: 'End customers with self-service portal access',
  },
]

export const USER_TYPES: SeedUserType[] = [
  { name: 'Employee', description: 'CCB employee' },
  { name: 'Customer', description: 'End-customer / resident' },
]

// ---------------------------------------------------------------------------
// Navigation modules (PModules)
// type: PAGE  — module is itself a navigable page (no sub-menu)
// type: MENU  — module opens a dropdown with SubModules
// ---------------------------------------------------------------------------

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
    code: 'COMMUNITY_LIST',
    type: 'PAGE',
    icon: 'Building2',
    url: '/communities',
    displayOrder: 2,
  },
  {
    moduleName: 'Meter Management',
    code: 'METER_MANAGEMENT',
    type: 'MENU',
    icon: 'Activity',
    displayOrder: 3,
  },
  {
    moduleName: 'Billing Management',
    code: 'BILLING_MANAGEMENT',
    type: 'MENU',
    icon: 'Receipt',
    displayOrder: 4,
  },
  {
    moduleName: 'Admin',
    code: 'ADMIN',
    type: 'MENU',
    icon: 'Settings',
    displayOrder: 5,
  },
]

// ---------------------------------------------------------------------------
// SubModules
// Meter/Billing submodules have URLs (they ARE the pages).
// Admin submodules are groupers (no URL — their Screens are the pages).
// ---------------------------------------------------------------------------

export const SUB_MODULES: SeedSubModule[] = [
  // ── Meter Management ──────────────────────────────────────────────────────
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
    name: 'SFTP File Monitor',
    code: 'SFTP_MONITOR',
    icon: 'FolderSync',
    url: '/meters/sftp-monitor',
    displayOrder: 2,
  },
  {
    pModuleCode: 'METER_MANAGEMENT',
    name: 'Daily Meter Readings',
    code: 'DAILY_METER_READINGS',
    icon: 'BarChart2',
    url: '/meters/daily-meter-readings',
    displayOrder: 3,
  },
  {
    pModuleCode: 'METER_MANAGEMENT',
    name: 'Billing Readiness',
    code: 'BILLING_READINESS',
    icon: 'BadgeCheck',
    url: '/meters/billing-readiness',
    displayOrder: 4,
  },

  // ── Billing Management ────────────────────────────────────────────────────
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

  // ── Admin (groupers — Screens below define the actual pages) ──────────────
  {
    pModuleCode: 'ADMIN',
    name: 'System Admin',
    code: 'SYSTEM_ADMIN',
    icon: 'Shield',
    displayOrder: 1,
  },
  {
    pModuleCode: 'ADMIN',
    name: 'Business Admin',
    code: 'BUSINESS_ADMIN',
    icon: 'Briefcase',
    displayOrder: 2,
  },
]

// ---------------------------------------------------------------------------
// Screens (children of SubModules — used for the Admin section where
// each sub-module groups multiple navigable screens)
// ---------------------------------------------------------------------------

export const SCREENS: SeedScreen[] = [
  // ── System Admin ──────────────────────────────────────────────────────────
  {
    subModuleCode: 'SYSTEM_ADMIN',
    name: 'User Management',
    code: 'USER_LIST',
    url: '/admin/system/users',
    displayOrder: 1,
  },
  {
    subModuleCode: 'SYSTEM_ADMIN',
    name: 'Role Management',
    code: 'ROLE_MANAGEMENT',
    url: '/admin/system/roles',
    displayOrder: 2,
  },
  {
    subModuleCode: 'SYSTEM_ADMIN',
    name: 'Implementation Config',
    code: 'CONFIG',
    url: '/admin/system/config',
    displayOrder: 3,
  },

  // ── Business Admin ────────────────────────────────────────────────────────
  {
    subModuleCode: 'BUSINESS_ADMIN',
    name: 'Tariff Configuration',
    code: 'TARIFF_MANAGEMENT',
    url: '/admin/business/tariff',
    displayOrder: 1,
  },
  {
    subModuleCode: 'BUSINESS_ADMIN',
    name: 'Billing Cycle Configuration',
    code: 'BILLING_CYCLE',
    url: '/admin/business/billing-cycle',
    displayOrder: 2,
  },
  {
    subModuleCode: 'BUSINESS_ADMIN',
    name: 'Workflow Management',
    code: 'WORKFLOW_MGMT',
    url: '/admin/business/workflow',
    displayOrder: 3,
  },
]

// ---------------------------------------------------------------------------
// Actions (fine-grained permission codes within a Screen)
// Codes must match keys in ROUTE_CODE_MAP on the frontend.
// ---------------------------------------------------------------------------

export const ACTIONS: SeedAction[] = [
  // ── User Management ───────────────────────────────────────────────────────
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

  // ── Role Management ───────────────────────────────────────────────────────
  {
    screenCode: 'ROLE_MANAGEMENT',
    name: 'Create Role',
    code: 'CREATE_ROLE',
    description: 'Access the create-role form',
  },
  {
    screenCode: 'ROLE_MANAGEMENT',
    name: 'Edit Role',
    code: 'EDIT_ROLE',
    description: 'Access the edit-role and permissions form',
  },

  // ── Tariff Configuration ──────────────────────────────────────────────────
  {
    screenCode: 'TARIFF_MANAGEMENT',
    name: 'Tariff Approval Queue',
    code: 'TARIFF_APPROVAL_QUEUE',
    description: 'Access the tariff pending-approval queue',
  },
  {
    screenCode: 'TARIFF_MANAGEMENT',
    name: 'Create Tariff',
    code: 'TARIFF_CREATE',
    description: 'Access the create-tariff workflow',
  },
  {
    screenCode: 'TARIFF_MANAGEMENT',
    name: 'View Tariff Detail',
    code: 'TARIFF_VIEW',
    description: 'View a tariff version detail page',
  },
]

// ---------------------------------------------------------------------------
// Roles
// SUPER_ADMIN and ADMIN automatically receive all menus (handled in
// UserService.getProfile — no role_permission records required).
// Other roles start with no permissions; they are configured via the
// Role Management UI.
// ---------------------------------------------------------------------------

export const ROLES: SeedRole[] = [
  {
    roleName: 'SUPER_ADMIN',
    roleDescription:
      'Full system access — all modules, all actions, all data. Bypasses permission checks.',
    userCategoryName: 'Internal',
    userTypeName: 'Employee',
    canBeReportingManager: false,
  },
  {
    roleName: 'FINANCE',
    roleDescription: 'Billing, invoicing, tariff approval, and payment operations',
    userCategoryName: 'Internal',
    userTypeName: 'Employee',
    canBeReportingManager: true,
  },
  {
    roleName: 'OPERATIONS',
    roleDescription:
      'Meter management, daily readings review, anomaly resolution, and billing readiness',
    userCategoryName: 'Internal',
    userTypeName: 'Employee',
    canBeReportingManager: true,
  },
  {
    roleName: 'CUSTOMER_SUPPORT',
    roleDescription:
      'Customer-facing support, reading enquiry resolution, and dispute handling',
    userCategoryName: 'Internal',
    userTypeName: 'Employee',
    canBeReportingManager: false,
  },
  {
    roleName: 'CUSTOMER',
    roleDescription: 'End-customer self-service portal access',
    userCategoryName: 'External',
    userTypeName: 'Customer',
    canBeReportingManager: false,
  },
]
