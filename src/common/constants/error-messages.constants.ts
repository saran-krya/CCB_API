/**
 * User-facing error messages that are raised from more than one place. The text is part of the API contract (clients
 * and specs match on it), so a value here is never reworded in passing. Messages built with a runtime value
 * (`Property ${id} not found`) stay inline next to the code that knows the value.
 */
export const ERROR_MESSAGES = {
  // Generic
  INTERNAL_SERVER_ERROR: 'Internal server error',
  REQUEST_BODY_UNPARSEABLE: 'The request body could not be parsed.',
  UNKNOWN_ERROR: 'Unknown error',
  NO_FILE_UPLOADED: 'No file uploaded',

  // Authentication and session
  INVALID_CREDENTIALS: 'Invalid credentials',
  INVALID_REFRESH_TOKEN: 'Invalid refresh token',
  REFRESH_TOKEN_ALREADY_USED: 'Refresh token already used',
  INVALID_TOKEN_PAYLOAD: 'Invalid token payload',
  ACCOUNT_NOT_ACTIVE: 'Account is not active',
  ACCOUNT_DEACTIVATED: 'Account is deactivated',
  ACCOUNT_INACTIVE_CONTACT_ADMIN: 'Your account is inactive. Please contact your administrator.',
  NO_ROLE_ASSIGNED: 'No role assigned',
  CURRENT_PASSWORD_INCORRECT: 'Current password is incorrect',
  SESSION_TIMEOUT_NOT_CONFIGURED: 'SESSION_TIMEOUT_MINUTES is not configured',

  // Not found
  USER_NOT_FOUND: 'User not found',
  CUSTOMER_NOT_FOUND: 'Customer not found',
  ROLE_NOT_FOUND: 'Role not found',
  POLICY_NOT_FOUND: 'Policy not found',
  INLINE_POLICY_NOT_FOUND: 'Inline policy not found',
  ACTION_NOT_FOUND: 'Action not found',
  SCREEN_NOT_FOUND: 'Screen not found',
  MODULE_NOT_FOUND: 'Module not found',
  SUB_MODULE_NOT_FOUND: 'Sub module not found',
  PERMISSION_MODULE_NOT_FOUND: 'Permission module not found',
  ATTRIBUTE_NOT_FOUND: 'Attribute not found',
  COMMUNITY_NOT_FOUND: 'Community not found',
  AUDIT_LOG_NOT_FOUND: 'Audit log entry not found',
  MODULE_PROTECTED_CANNOT_DEACTIVATE: 'This module is required by the platform and cannot be deactivated',
  MODULE_PROTECTED_CANNOT_DELETE: 'This module is required by the platform and cannot be deleted',
  MODULE_PROTECTED_CODE_LOCKED: 'The code of a module required by the platform cannot be changed',
  MODULE_HAS_CHILDREN: 'Delete or move this module\'s sub-modules and screens before deleting the module',
  // A sub-module/screen that belongs to a protected module (pmodules.constants.ts, PROTECTED_MODULE_CODES) is itself
  // protected: deleting, deactivating, re-coding or re-parenting it away would dismantle a module the platform cannot
  // work without just as effectively as touching the module row directly (see PModulesService's own doc comment).
  SUB_MODULE_PROTECTED_CANNOT_DEACTIVATE: 'This sub-module belongs to a module required by the platform and cannot be deactivated',
  SUB_MODULE_PROTECTED_CANNOT_DELETE: 'This sub-module belongs to a module required by the platform and cannot be deleted',
  SUB_MODULE_PROTECTED_CODE_LOCKED: 'The code of a sub-module that belongs to a module required by the platform cannot be changed',
  SUB_MODULE_PROTECTED_CANNOT_REPARENT: 'This sub-module belongs to a module required by the platform and cannot be moved to another module',
  SCREEN_PROTECTED_CANNOT_DEACTIVATE: 'This screen belongs to a module required by the platform and cannot be deactivated',
  SCREEN_PROTECTED_CANNOT_DELETE: 'This screen belongs to a module required by the platform and cannot be deleted',
  SCREEN_PROTECTED_CODE_LOCKED: 'The code of a screen that belongs to a module required by the platform cannot be changed',
  SCREEN_PROTECTED_CANNOT_REPARENT: 'This screen belongs to a module required by the platform and cannot be moved to another module or sub-module',
  SUB_MODULE_HAS_CHILDREN: 'Delete or move this sub-module\'s screens before deleting the sub-module',
  SCREEN_HAS_CHILDREN: 'Delete or move this screen\'s actions before deleting the screen',
  PROPERTY_NOT_FOUND: 'Property not found',
  UNIT_NOT_FOUND: 'Unit not found',
  MASTER_METER_NOT_FOUND: 'Master meter not found',
  SUB_METER_NOT_FOUND: 'Sub meter not found',
  TARIFF_NOT_FOUND: 'Tariff not found',
  BILLING_CYCLE_NOT_FOUND: 'Billing cycle not found',
  BILL_RUN_NOT_FOUND: 'Bill run not found',
  BILL_NOT_FOUND: 'Bill not found',
  REGISTRATION_REQUEST_NOT_FOUND: 'Registration request not found',
  REGISTRATION_DOCUMENT_NOT_FOUND: 'Document not found on this registration request',
  EXTRACTED_FIELD_NOT_FOUND: 'Extracted field not found on this document',
  NO_REGISTRATION_REQUEST_FOR_ACCOUNT: 'No registration request found for your account',

  // Already exists
  ROLE_ALREADY_EXISTS: 'Role already exists',
  POLICY_NAME_ALREADY_EXISTS: 'A policy with this name already exists',
  PERMISSION_MODULE_ALREADY_EXISTS: 'Permission module already exists',
  SUB_MODULE_ALREADY_EXISTS: 'Sub module already exists',
  PROPERTY_CODE_ALREADY_EXISTS: 'Property code already exists',
  UNIT_NUMBER_ALREADY_EXISTS: 'Unit number already exists in this property',

  // Validation and permission
  POLICY_NAME_REQUIRED: 'Policy name is required',
  SCREEN_PARENT_CONFLICT: 'A screen cannot belong to both a SubModule and a PModule. Provide only one.',
  NO_IMPORT_COLUMNS_CONFIGURED: 'No import columns are configured for this meter type',
  CANNOT_CHANGE_OWN_ROLES: 'You cannot change your own roles.',
  UNIT_NOT_ASSOCIATED_WITH_ACCOUNT: 'This unit is not associated with your account',
};
