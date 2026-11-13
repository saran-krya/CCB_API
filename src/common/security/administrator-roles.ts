import { ROLES } from '../constants/global';

/**
 * ADMINISTRATOR ROLES — the one place that says which role name means "this installation's super administrator".
 *
 * CCB is on-premises software: each customer runs its own installation with its own database and its own users. Its highest
 * administrator is the SUPER_ADMIN (common/constants/global.ts). Everything that has to recognise the administrator by name goes
 * through this module (RolesGuard's bypass, the privilege rules in UserRoleService / UserService / RoleService, the boot-time policy
 * sync, the business-approval exclusion, the workflow-approver exclusion), so a change of name is made in exactly one place. A
 * look-alike never counts: the match is exact, because the database compares role names case- and accent-insensitively.
 *
 * A DELEGATED administrator (an "ADMIN") is NOT in this list and never becomes part of it: it is an ordinary dynamic role whose Policies
 * grant administrative permissions. The roles listed here are exactly the ones that nobody outside them may hand out, edit or take over
 * (actor.ts), that RolesGuard lets through every @Roles check, and whose last active holder can never be removed.
 */

/** The roles that ADMINISTER an installation, in the order locks are taken on them. */
export const ADMINISTRATOR_ROLES = [ROLES.SUPER_ADMIN] as const;
export type AdministratorRole = (typeof ADMINISTRATOR_ROLES)[number];

/** Exact match only — the database compares role names case- and accent-insensitively, so a look-alike must never pass as an administrator. */
export const isAdministratorRoleName = (roleName: string | null | undefined): roleName is AdministratorRole =>
  roleName === ROLES.SUPER_ADMIN;

/** The administrator roles among `roleNames`, in ADMINISTRATOR_ROLES order, each once. */
export const administratorRolesAmong = (roleNames: readonly string[]): AdministratorRole[] =>
  ADMINISTRATOR_ROLES.filter((role) => roleNames.includes(role));
