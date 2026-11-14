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
  /** Sign-in, lock-out, access-denied and other security events (SecurityEventService). */
  SECURITY: 'security',
  /** Lookup Field Master (list-of-values) changes. */
  LOV: 'lov',
  /** Module Catalog changes (modules, sub-modules, screens): what appears in every user's menu. */
  MODULE_CATALOG: 'module_catalog',
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
/** The `action` verbs of the SECURITY events (AUDIT_MODULE.SECURITY, written by SecurityEventService). `entityId` is the account concerned when there is one. */
export const SECURITY_EVENT = {
  /** A sign-in was refused (wrong credentials). Recorded at most once a minute per account and client, so an attack cannot flood the trail. */
  LOGIN_FAILED: 'LOGIN_FAILED',
  /** A client was refused for an account after too many failures. */
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  /** An account went into protected mode: too many failures from too many clients, so only clients that signed in before may still try. */
  ACCOUNT_PROTECTED: 'ACCOUNT_PROTECTED',
  /** A client IP was locked for every account. */
  IP_LOCKED: 'IP_LOCKED',
  /** An administrator (or the maintenance tool) cleared an account's lock-out counters. */
  SIGNIN_UNLOCKED: 'SIGNIN_UNLOCKED',
  /** A refresh token that was already used (or revoked) was presented: the whole session was ended. */
  REFRESH_REPLAY_DETECTED: 'REFRESH_REPLAY_DETECTED',
  /** A signed-in user was refused (403) by the authorization guards. Recorded at most once a minute per user and route. */
  ACCESS_DENIED: 'ACCESS_DENIED',
  /** The CORRECT password was presented for an account whose status currently refuses sign-in (a deactivated staff
   *  account; an overdue customer account) — the authenticated identity is confirmed, only its standing is refused
   *  (AuthService.login's own "authenticated identity, refused standing" distinction). Deliberately separate from
   *  LOGIN_FAILED, which never confirms a credential for the account it names: this one means whoever tried it
   *  already knows the real password, which is worth an operator's attention on its own (a departed employee's
   *  credentials, for example) even though the client-facing 403 already says the account is disabled — no new
   *  information reaches the client either way, this only adds server-side visibility. */
  SIGNIN_BLOCKED_ACCOUNT_STATUS: 'SIGNIN_BLOCKED_ACCOUNT_STATUS',
  MFA_ENROLLED: 'MFA_ENROLLED',
  MFA_DISABLED: 'MFA_DISABLED',
  MFA_VERIFY_FAILED: 'MFA_VERIFY_FAILED',
  MFA_RECOVERY_CODE_USED: 'MFA_RECOVERY_CODE_USED',
  MFA_RECOVERY_CODES_REGENERATED: 'MFA_RECOVERY_CODES_REGENERATED',
  MFA_RESET_BY_ADMINISTRATOR: 'MFA_RESET_BY_ADMINISTRATOR',
  PASSWORD_RECOVERY_REQUESTED: 'PASSWORD_RECOVERY_REQUESTED',
  PASSWORD_RECOVERY_COMPLETED: 'PASSWORD_RECOVERY_COMPLETED',
  PASSWORD_RECOVERY_FAILED: 'PASSWORD_RECOVERY_FAILED',
  AUDIT_EXPORTED: 'AUDIT_EXPORTED',
  AUDIT_INTEGRITY_FAILED: 'AUDIT_INTEGRITY_FAILED',
} as const;

export const AUDIT_CREDENTIAL_ACTION = {
  /** The signed-in account changed its OWN password (its current password was verified first). */
  CHANGE_PASSWORD: 'CHANGE_PASSWORD',
  /** A password change was refused because the current password was wrong; `newValue.locked` says whether that very
   *  failure tripped the sign-in lock-out. Attempts refused while the account is already locked are logged, not audited. */
  CHANGE_PASSWORD_FAILED: 'CHANGE_PASSWORD_FAILED',
};
