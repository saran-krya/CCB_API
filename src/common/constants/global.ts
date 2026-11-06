/**
 * SUPER_ADMIN is the ONLY predefined (static) role in the system. Every other role is created and managed dynamically by
 * SUPER_ADMIN through the application and lives only in the database — never add another role name here, and never
 * branch on, reserve, seed or auto-grant one by name. Authorization for everything else is permission-based: the
 * attached Policies of the roles a user currently holds.
 */
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;

