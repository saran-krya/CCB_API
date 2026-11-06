/**
 * The application areas that system attributes and list-of-values categories are grouped under (the admin UI's module
 * keys). Only the keys referenced from more than one place are listed; `as const` because the attribute DTO derives
 * its allowed-value type from them.
 */
export const APP_MODULE_KEY = {
  CUSTOMER: 'customer',
  METER: 'meter',
  BILLING_CYCLE: 'billing-cycle',
  TARIFF: 'tariff',
  USER_MANAGEMENT: 'user-management',
  ROLE_MANAGEMENT: 'role-management',
} as const;
