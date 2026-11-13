/**
 * The predefined (static) roles of the system. CCB is on-premises software: every customer runs its OWN installation with its OWN
 * database, so there is exactly ONE predefined role — the installation's super administrator. Every other role (an "ADMIN", a
 * finance role, ...) is created and managed dynamically by that administrator through the application and lives only in the
 * database — never add another role name here, and never branch on, reserve, seed or auto-grant one by name. Authorization for
 * everything else is permission-based: the attached Policies of the roles a user currently holds.
 *
 *  - SUPER_ADMIN — the customer's own highest administrator, inside that customer's installation ONLY. It manages the installation's
 *                   users, roles, policies, attributes, lists of values and company-level settings, may create further administrators,
 *                   and may hand out or take over the SUPER_ADMIN role itself. It is NOT a CCB (vendor) account: CCB holds no account in a
 *                   customer's installation, and the role has no reach beyond the database of the installation it was created in.
 *
 * A delegated administrator ("ADMIN") is NOT a predefined role and has no special code path: it is an ordinary dynamic role whose
 * Policies grant administrative permissions, and it can never receive SUPER_ADMIN privileges by being an administrator.
 */
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
