
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
]


export const SUB_MODULES: SeedSubModule[] = [
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
    subModuleCode: 'TARIFF_CONFIG',
    name: 'Tariff Configuration',
    code: 'TARIFF_CONFIG',
    url: '/admin/business/tariff-config/overview',
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
    subModuleCode: 'METER_INVENTORY',
    name: 'Meter Inventory',
    code: 'METER_INVENTORY',
    url: '/meters/inventory',
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
    name: 'Edit Billing Cycle',
    code: 'EDIT_BILLING_CYCLE',
    description: 'Edit an editable billing cycle version, including the active/inactive toggle',
    displayOrder: 2,
  },
  {
    screenCode: 'BILLING_CYCLE',
    name: 'Create New Billing Cycle Version',
    code: 'BILLING_CYCLE_NEW_VERSION',
    description: 'Clone the current governing billing cycle into a new pending version',
    parentActionCode: 'EDIT_BILLING_CYCLE',
    displayOrder: 1,
  },
  {
    screenCode: 'BILLING_CYCLE',
    name: 'Deprecate Billing Cycle',
    code: 'BILLING_CYCLE_DEPRECATE',
    description: 'Permanently deprecate a billing cycle version, immediately or on a future date',
    parentActionCode: 'EDIT_BILLING_CYCLE',
    displayOrder: 2,
  },
  {
    screenCode: 'BILLING_CYCLE',
    name: 'View Billing Cycle',
    code: 'VIEW_BILLING_CYCLE',
    description: 'View billing cycle list and detail pages',
    displayOrder: 3,
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
    displayOrder: 4,
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
]


export const ADMIN_GRANT_EXCLUDED_ACTION_CODES = [
  'TARIFF_APPROVE',
  'TARIFF_REJECT',
  'BILLING_CYCLE_APPROVE',
  'BILLING_CYCLE_REJECT',
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
    roleName: 'CUSTOMER',
    roleDescription: 'End-customer self-service portal access',
    userCategoryName: 'External',
    canBeReportingManager: false,
  },
]
