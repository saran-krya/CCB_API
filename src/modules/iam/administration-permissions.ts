import { NAV_ONLY_ACTION_CODES, RESOURCES } from './resource-catalog';

/**
 * ADMINISTRATION PERMISSIONS — the permissions of the SUPER_ADMIN Administration Console that no other role or account may ever hold.
 *
 * CCB has two applications on one installation: the CCB Business Application (customers, communities, meters, billing, finance …, whose
 * permissions a super administrator hands out freely to ordinary roles such as ADMIN, MANAGER or STAFF) and the Administration Console
 * (users, roles, policies, system health, settings, audit …), which belongs to the installation's SUPER_ADMIN alone. Most console screens are
 * already guarded by `@Roles(SUPER_ADMIN)` and so have no permission code at all (Platform Overview, Module Catalog, System Health, Application
 * Information, Audit Logs, Platform Settings, Email Templates, the Policy and Resource catalogues). What remains are the console screens that
 * ALSO exist as grantable permission codes — Internal Users, Roles & Permissions and the nav-only Policy / Resource codes — and, through
 * them, the staff invitations and password resets that ride on the Users codes. THOSE are listed here, derived from the resource catalogue so
 * that a code added to the Users or Roles resource later is protected without anyone remembering to list it.
 *
 * How the set is enforced (all on the server — the web app only hides what the server would refuse):
 *   - IamService.getActionCodesGrantedByPoliciesForRoles — the one place every authorization read passes through — drops these codes from
 *     the union of any principal that does not hold SUPER_ADMIN, whatever policy, inline policy or role lists them. A grant that predates this
 *     rule is therefore inert at runtime, without touching a single database row.
 *   - IamService.validateStatements — managed, role-inline and user-inline policies cannot list them (400).
 *   - IamService.attachPolicyToRole — a policy that lists them can only be attached to SUPER_ADMIN (400).
 *   - RolePermissionsService (the legacy permission tree) — neither shows nor saves them for any other role (400).
 *   - IamService.findAllResourcesWithActions flags the resources, so the Policy editor's resource picker does not offer them.
 *
 * SUPER_ADMIN keeps them through its system policy, which is synced directly from the catalogue and never goes through those write guards.
 * Deliberately NOT here: the personal Account settings (every user manages their own profile and password), System Attributes and Lookup Values
 * (configuration the business roles' screens depend on) and Approval Workflows — a super administrator can still delegate those.
 * DECIDED 2026-11-12: System Attributes and Lookup Values stay assignable to authorized business roles — do not add the ATTRIBUTE / LOV resources here.
 */

/** The catalogue resources that are administration-only: the Users and Roles screens of the console. */
export const ADMINISTRATION_RESOURCE_CODES: ReadonlySet<string> = new Set(['USER', 'ROLE']);

/** Every action code only SUPER_ADMIN may hold: all of the administration resources' actions, plus the nav-only Policy / Resource codes
 *  (no resource, because policy authoring is `@Roles(SUPER_ADMIN)`). */
export const ADMINISTRATION_ACTION_CODES: ReadonlySet<string> = new Set([
  ...RESOURCES.filter((resource) => ADMINISTRATION_RESOURCE_CODES.has(resource.code)).flatMap((resource) => resource.actionCodes),
  ...NAV_ONLY_ACTION_CODES,
]);

/** The sidebar sub-modules and screens of the legacy permission tree that stand for those same console pages (bootstrap/seed-data.ts —
 *  System Admin > User Management, Role Management, Policy Management, Resource Catalog). Their sibling sub-modules (Attributes, Lookup Field
 *  Master, Document Set Definition) are business configuration and are not listed. */
export const ADMINISTRATION_SUB_MODULE_CODES: ReadonlySet<string> = new Set(['USER_MANAGEMENT', 'ROLE_MANAGEMENT', 'POLICY_MANAGEMENT', 'RESOURCE_CATALOG']);
export const ADMINISTRATION_SCREEN_CODES: ReadonlySet<string> = new Set(['USER_LIST', 'ROLE', 'POLICY', 'RESOURCE']);

export const isAdministrationActionCode = (code: string): boolean => ADMINISTRATION_ACTION_CODES.has(code);

/** The administration codes among `codes`, each once, sorted — what a refusal names. */
export const administrationActionCodesIn = (codes: Iterable<string>): string[] => [...new Set([...codes].filter(isAdministrationActionCode))].sort();

/** The 400 message when a grant would hand administration permissions to anyone but SUPER_ADMIN. `codes` are the offending action codes. */
export const administrationGrantMessage = (codes: readonly string[]): string =>
  `${codes.join(', ')} ${codes.length === 1 ? 'is an administration permission' : 'are administration permissions'}: they belong to the SUPER_ADMIN Administration Console ` +
  'alone and cannot be granted to any other role or user. Give the role business permissions only.';
