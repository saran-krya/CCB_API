/**
 * The `moduleName` written on audit-log rows and used to read them back. Each value is what is already stored in
 * `audit_logs.module_name`, so the casing/format differences between entries are historical and must not be
 * "tidied" (that would orphan the existing rows).
 */
export const AUDIT_MODULE = {
  ACTIONS: 'actions',
  ATTRIBUTES: 'attributes',
  BILL_RUN: 'BillRun',
  BILLING_CYCLES: 'billing_cycles',
  BILLING_MANAGEMENT: 'BILLING_MANAGEMENT',
  COMMUNITIES: 'communities',
  CUSTOMERS: 'customers',
  METER: 'Meter',
  METER_READING: 'MeterReading',
  ORGANIZATIONS: 'organizations',
  SUBSCRIPTION_PLANS: 'subscription_plans',
  POLICIES: 'policies',
  PROPERTIES: 'properties',
  REGISTRATION_DOCUMENT_RULES: 'registration-document-rules',
  REGISTRATION_REQUESTS: 'registration-requests',
  ROLE_INLINE_POLICIES: 'role_inline_policies',
  ROLE_PERMISSIONS: 'role_permissions',
  ROLE_POLICIES: 'role_policies',
  ROLES: 'roles',
  TARIFF: 'Tariff',
  UNITS: 'units',
  USER_INLINE_POLICIES: 'user_inline_policies',
  USER_ROLES: 'user_roles',
  USERS: 'users',
};

/** The `action` verbs used by more than one audit entry (create / update / delete / approve, activate / deactivate and the
 *  meter import pair). Module-specific verbs (TariffAuditAction, BillingCycleAuditAction, ...) stay with their module. */
export const AUDIT_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  APPROVE: 'APPROVE',
  ACTIVATE: 'ACTIVATE',
  DEACTIVATE: 'DEACTIVATE',
  IMPORT: 'IMPORT',
  IMPORT_FAILED: 'IMPORT_FAILED',
};

/** The `action` verbs of the SELF-SERVICE password flow (AuthService.changePassword), written under AUDIT_MODULE.USERS for a
 *  staff user or AUDIT_MODULE.CUSTOMERS for a portal account, with the account itself as `entityId`. They are credential
 *  events, so their `newValue` never holds a password or a hash. The admin-triggered credential actions
 *  (ADMIN_RESET_PASSWORD, DISABLE_SIGNIN_ACCESS, REVOKE_SESSIONS) keep writing the strings already stored in
 *  `audit_logs.action`. */
export const AUDIT_CREDENTIAL_ACTION = {
  /** The signed-in account changed its OWN password (its current password was verified first). */
  CHANGE_PASSWORD: 'CHANGE_PASSWORD',
  /** A password change was refused because the current password was wrong; `newValue.locked` says whether that very
   *  failure tripped the sign-in lock-out. Attempts refused while the account is already locked are logged, not audited. */
  CHANGE_PASSWORD_FAILED: 'CHANGE_PASSWORD_FAILED',
};
