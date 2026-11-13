# Security hardening — how the API protects itself, and what only an operator can do

This is the reference for the IAM / RBAC security remediation. It describes the behaviour that is in the code,
where to find it, and — in section 8 — the actions that cannot be done from code (rotating third-party
secrets, provisioning database accounts, deploying env files).

## 1. Authorization model

* **Deny by default.** `PermissionGuard` (the last global guard) denies a staff request unless the route
  carries an explicit rule: `@Public`, `@Permission(...)`, `@Roles(...)` or `@Authenticated()`. A route with no
  rule is refused and logged, so a forgotten decorator fails closed (the route is unusable until it is given a
  rule) instead of open. Every existing handler was reconciled against this rule during the remediation.
* **Guard order** (`src/auth/auth.module.ts`): rate limit → JWT → customer access → mandatory password change →
  `@Roles` → `@Permission` / `@Authenticated`. A user's roles, active flag and password-change flag are re-read
  from the database on **every** request (`UserService.findAuthState`, two lean queries, never cached), so a
  revoked role or a deactivated account takes effect on the next request.
* **Multi-role union.** A route needing codes `A` or `B` is allowed if any of the user's current roles — or the
  user's own inline policies — grants any of them. All codes are resolved in one call
  (`RolePermissionsService.rolesHaveAnyAction`).
* **Role names grant nothing by themselves.** No role name gates a role route (they are permission-based).
  `SUPER_ADMIN` is the ONLY predefined role and the only reserved role name (section 11): it cannot be created,
  renamed into/away from, or deleted through the API, and only a `SUPER_ADMIN` may edit it. The match is on a
  canonical form (trimmed, upper-cased, accents/width/invisible characters removed) because the database compares
  names accent- and case-insensitively and the boot-time reconciliation looks the system role up by name — a
  look-alike such as `SÜPER_ADMIN` or `super_admín` is therefore reserved too, and that reconciliation additionally
  accepts only the exact name. Every other role is created dynamically by `SUPER_ADMIN`; none is special. Policy/IAM
  structure controllers remain `SUPER_ADMIN`-only by design.
* Public (unauthenticated) routes — exactly five: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`,
  `GET /auth/sso`, `POST /customers/activate`.

## 2. SUPER_ADMIN protections (enforced in the services, never only in the UI)

The acting user is passed to the services as an `Actor` built from the live principal
(`src/common/security/actor.ts`); the body of a request can never supply it.

| Rule | Where | Response |
|---|---|---|
| Only a SUPER_ADMIN may assign the SUPER_ADMIN role — on create user, on add roles, any other path | `UserService.create` / `addRoles` (pre-check) and `UserRoleService.addRolesToUser` (authoritative, same transaction) | 403 `Only SUPER_ADMIN can assign the SUPER_ADMIN role.` |
| Only a SUPER_ADMIN may modify a SUPER_ADMIN account (edit, deactivate, delete, change roles, reset password, disable sign-in, revoke sessions) | `UserRoleService.assertActorMayModifyUser`, called by `UserService` and `AuthService` | 403 `Only SUPER_ADMIN can modify a SUPER_ADMIN account.` |
| Nobody changes their own roles, deletes their own account, or deactivates themselves | `UserRoleService`, `UserService.update` / `remove` | 403 |
| The last **active, non-deleted** SUPER_ADMIN can never be demoted, deactivated or deleted | `UserRoleService.assertNotLastActiveAdministrator` / `lockActiveHolders` (pessimistic row lock inside the same transaction) | 403 |
| The installation's **initial** SUPER_ADMIN (the oldest active holder — derived from the data, no marker column) can never be deleted, deactivated, demoted or have its sign-in disabled through the application, even while other administrators exist; handing it over is a server-side step (`npm run maintenance:super-admin -- --retire …`) | `UserRoleService.initialAdministratorId` / `assertNotInitialAdministrator` / `assertNotLastActiveAdministrator` / `removeRoleFromUser`; `AuthService.disableSigninAccess` | 403 `Cannot … the initial SUPER_ADMIN account — it is protected …` |
| **Assignment boundary:** a delegated administrator may assign a role only if every permission the role grants is one the administrator holds itself (policies + inline policies of its current roles + its own inline policies, read live); a SUPER_ADMIN and the boot-time system are unbounded. Policies, inline policies, the resource catalogue and role-permission trees are not delegable at all (`@Roles(SUPER_ADMIN)`) | `AssignmentBoundaryService`, enforced in the one grant path `UserRoleService.addRolesToUser` (create user, add roles, bootstrap all go through it) | 403 `Cannot assign the role "X": it grants permissions you do not hold (…)` |
| **The same boundary on taking over an account:** a delegated administrator may reset the password of an account only if every permission the account holds is one the administrator holds itself (otherwise `RESET_USER_PASSWORD` would be a way around the role boundary: reset a more privileged user's password, sign in as them). The refusal names no permission | `AssignmentBoundaryService.assertAccountWithinBoundary`, via `UserRoleService.assertActorMayTakeOverAccount`, called by `AuthService.adminResetPassword` | 403 `Cannot reset the password of this account: it holds permissions you do not hold. …` |
| A user always keeps at least one role | `UserRoleService.removeRoleFromUser` | 403 |
| `UpdateUserDto` has no password and no role field | `src/modules/user/dto/create-user.dto.ts` | 400 (global `forbidNonWhitelisted`) |
| The role pickers say which roles the viewer may assign (`assignable`, `assignableReason`) so the web app can show a role disabled with the reason — **"Only SUPER_ADMIN can assign this role."** for SUPER_ADMIN, **"This role grants permissions you do not hold."** for a role beyond the viewer's scope | `RoleService.getRoleDropdown` / `getRolePicker` | — |

## 3. Authentication and sessions

* **Password policy** (`src/common/validators/strong-password.validator.ts`): at least 12 characters and at most
  72 **bytes** (UTF-8), at least three of {uppercase, lowercase, number, symbol}, not one repeated character. The
  ceiling is a byte count because every password is hashed with bcrypt, which reads only the first 72 bytes and
  ignores the rest — a longer password would only look stronger (an English letter is 1 byte, an Arabic letter 2, so
  about 36 Arabic letters reach it). `PASSWORD_MAX_BYTES` is the one constant behind the validator, the DTO
  `maxLength` documentation and `GET /settings/system` → `security.passwordPolicy.maxLength` (a byte count).
  Passwords set before this limit (up to 128 characters) keep signing in unchanged — bcrypt never looked past byte
  72 — and only a *new* password is held to it. Applied on user creation, change password, admin reset, customer
  activation and the bootstrap admin.
* **Mandatory password change** is enforced by `PasswordChangeGuard`: while `mustChangePassword` is true a staff
  user gets 403 `PASSWORD_CHANGE_REQUIRED` everywhere except routes marked `@AllowPendingPasswordChange`.
  An admin reset defaults to `mustChangePassword = true`; the bootstrap admin is created with it set.
* **Brute force**: per-IP request throttling (`THROTTLE_*`, strict limits on credential routes) plus a failed
  sign-in lock-out per account **and** per IP (`LOGIN_*`), returning 429 with `Retry-After` before any password
  is checked; unknown emails are counted identically (no user enumeration). A counter that ever loses its expiry
  (a Redis hiccup between `INCR` and `EXPIRE`) is repaired on the next read, so a lock can never become permanent.
  Counters live in Redis when it is reachable and in process memory otherwise. A wrong **current password** on
  `PATCH /auth/change-password` counts toward the same account and IP counters (a locked account or IP gets the same
  429 before the password is checked; a correct current password clears the account's counter), so a stolen or
  unattended session cannot guess the password without meeting the sign-in lock-out. `loginLockoutLimits()`
  (`src/auth/login-attempts.service.ts`) is the one resolver of the thresholds.
* **Credential audit trail**: a self-service password change is recorded as `CHANGE_PASSWORD` and every wrong current
  password as `CHANGE_PASSWORD_FAILED` (`locked: true` on the failure that trips the lock-out), under module `users`
  (`customers` for a portal account) with the account as the entity — the same place the administrator actions
  (`ADMIN_RESET_PASSWORD`, `DISABLE_SIGNIN_ACCESS`, `REVOKE_SESSIONS`) are written. Attempts refused while the account
  is already locked are logged, not written to the audit table, so the lock-out path stays free of database writes.
  No entry ever holds a password or a hash. The audit write is best-effort: if it fails the change still succeeds and
  the failure is logged.
* **Tokens**: access tokens are HS256-only with the algorithm pinned; the secret must be ≥ 32 characters and not
  a placeholder or the app will not start. The refresh token lives only in an `HttpOnly` cookie (`ccb_rt`,
  path `/<prefix>/v1/auth`); cookie-based refresh/logout require the `X-CCB-Client` header (CSRF defence).
  Refresh rotation is atomic (a conditional `UPDATE … WHERE revoked_at IS NULL`); losing the race, or replaying
  a used token, revokes the whole token family and the device. `AUTH_REFRESH_IN_BODY=true` is a temporary
  compatibility switch and is off by default.
* **Remember me** (`rememberMe` on `POST /auth/login`, default `false`): the flag is stored on the session
  (`refresh_tokens.remember_me`, mirrored on `user_devices.remember_me` for Active Sessions) and carried from token to
  token on every refresh — it is read from the stored token, never from the request, so a refresh cannot upgrade an
  ordinary session. **Off:** the refresh cookie is a browser-session cookie (no `Max-Age`; the browser drops it when it
  closes) and the refresh token lives `REFRESH_TOKEN_EXPIRES_IN` (default `7d`). **On:** the cookie is persistent
  (`Max-Age` = the token's lifetime) and the refresh token lives `REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN` (default `30d`,
  never shorter than the normal lifetime; a malformed value stops the app from starting). Both lifetimes are sliding and
  neither touches the access token, whose lifetime is still the `SESSION_TIMEOUT_MINUTES` attribute. The server's expiry
  on the token is what is enforced: an expired token is refused and its session is revoked (device and login-history row
  closed with it). Sign-out, "sign out others", a revoke from Active Sessions and the admin revokes work on a remembered
  session exactly as on any other, because a session is the token family whichever lifetime it has.

## 4. HTTP surface and configuration

* Helmet headers, no `X-Powered-By`, CORS limited to `CORS_ORIGINS` (no wildcard; credentials allowed for those
  origins only), `TRUST_PROXY` so `req.ip` is the real client behind a proxy.
* Swagger UI / OpenAPI JSON are on by default only when `NODE_ENV=development`; elsewhere they need
  `SWAGGER_ENABLED=true`.
* **Fail-safe environment**: only `NODE_ENV=development` or `test` relax anything; a missing or mistyped value
  is production-like. In production-like environments schema auto-sync and SQL logging are off, and
  `DB_SYNCHRONIZE=true` is a startup error. `validateEnv` refuses weak/placeholder `JWT_SECRET`, a `root`
  database user, a wildcard CORS origin, and reports **key names only, never values**.
* Database errors are mapped to safe HTTP responses; no SQL text, parameters, table names or stack traces reach a
  response (`src/common/filters/db-error.mapper.ts`). Nest's own wording for a malformed JSON body (which quotes a
  fragment of the payload) and for an unmatched route (which repeats the query string) is replaced by fixed
  text, so request content and query-string tokens are never reflected back.
* Every numeric path parameter on the admin controllers goes through `ParseIntPipe`.

## 5. Data handling

* Soft-deleted rows no longer hold unique values hostage: names/emails/codes are released inside the creating
  transaction (`releaseSoftDeletedUnique`). Deleting a role, policy or user removes its dependents (inline
  policies, statements, assignments, sessions) in the same transaction.
* Attaching a policy twice is idempotent; a racing duplicate is a success, not a 500.
* `ensureAdminPolicyGrants` serves SUPER_ADMIN alone and never touches, creates or grants any other role (section
  11). The SUPER_ADMIN policy is system-managed and is kept complete — except for the business-approval codes,
  which SUPER_ADMIN never holds (section 10).
* System actions (every seeded code plus every Resource-catalog code) cannot be renamed, deactivated or deleted.
* Migration `1793800000000-ReactivateImportCenterViewAction` re-activates `IMPORT_CENTER_VIEW` (a single guarded
  `UPDATE`, no schema change).
* Existing-data repair is **not** automatic. Two operator scripts, dry-run by default, are provided:
  `npm run maintenance:iam-orphans` and `npm run maintenance:iam-policy-repair` (append `-- --apply` to write).
  See section 8.

## 6. Catalog codes that nothing on the server enforces

Documented here so they are a decision, not an accident: `CREATE_POLICY`,
`EDIT_POLICY`, `DELETE_POLICY`, `VIEW_POLICY`, `VIEW_RESOURCE` (UI gating only — policy administration is
`SUPER_ADMIN`-only on the server), `VIEW_ATTRIBUTE` (UI gating — attribute reads are `@Authenticated`), and four
reserved codes with no consumer yet: `BILL_RUN_HISTORICAL_APPROVE`, `BILL_RUN_HISTORICAL_SUBMIT`,
`METER_INVENTORY_DELETE`, `VIEW_SERVICE_REQUESTS_TICKETS`. Granting any of them changes nothing server-side.

## 7. Configuration reference

Every variable is listed, with comments and placeholders only, in `.env.example`. New in this work:
`CORS_ORIGINS`, `TRUST_PROXY`, `COOKIE_SAMESITE`, `COOKIE_SECURE`, `COOKIE_DOMAIN`, `REFRESH_COOKIE_NAME`,
`AUTH_REFRESH_IN_BODY`, `SWAGGER_ENABLED`, `DB_SYNCHRONIZE`, `DB_LOGGING`, `DB_MIGRATIONS_RUN`,
`DB_MIGRATION_USERNAME`, `DB_MIGRATION_PASSWORD`, `LOGIN_MAX_FAILED_PER_ACCOUNT`, `LOGIN_MAX_FAILED_PER_IP`,
`LOGIN_LOCK_MINUTES`, `THROTTLE_LIMIT`, `THROTTLE_TTL_SECONDS`, `THROTTLE_AUTH_LIMIT`, `THROTTLE_AUTH_TTL_SECONDS`,
`REFRESH_TOKEN_REMEMBER_ME_EXPIRES_IN`.

## 8. Actions only an operator can take

1. **Rotate secrets that were shared or sat in env files.** This work rotated `JWT_SECRET` (and the DEV admin
   bootstrap password) in the local `.env` / `.env.dev` files only. You must still: change the **remote DEV
   database** password and the **local MySQL root** password; rotate the **SFTP, SMTP, SSO client secret and
   ConverseZen API key** at their providers and put the new values in each environment's env file. Never reuse
   one environment's secret in another.
2. **Deploy the updated env file to the DEV server** (`.env.dev`, copied by hand; the process needs
   `APP_ENV=dev`) and restart the API. Changing `JWT_SECRET` signs everyone out once. Check `CORS_ORIGINS`
   lists the DEV web origin, and add `SWAGGER_ENABLED=false` if the Swagger UI should not be reachable on the
   DEV network (it is on by default while `NODE_ENV=development`). Note that `.env.dev` now sets
   `DB_SYNCHRONIZE=false` and `DB_LOGGING=false`: the DEV database schema is no longer rewritten from the entity
   classes at every start, so a future entity change needs a migration (`npm run migration:generate` / `migration:run`).
   This work itself changed no entity and added no table or column.
3. **Provision least-privilege database accounts** with `scripts/db/provision-db-users.sql` (a DBA runs it, once
   per environment, after replacing every placeholder), switch `DB_USERNAME`/`DB_PASSWORD` to the DML-only
   account, set `DB_MIGRATION_USERNAME`/`DB_MIGRATION_PASSWORD`, and set `DB_MIGRATIONS_RUN=false`. Then
   retire or rotate the old broad account.
4. **Change any live admin password that still equals an old env default** — the old default values are in
   git history and in the previous env files.
5. **Repair existing IAM data (after a backup of the shared database):** run
   `npm run maintenance:iam-orphans` and `npm run maintenance:iam-policy-repair` first as dry runs, read the
   counts, then repeat with `-- --apply` against each environment you intend to clean. The repair removes
   action codes the catalog does not allow from policy statements, but a policy left with no statements (for
   example the placeholder named "RENAME ME (original name lost…)", whose real actions were wiped by an earlier
   `synchronize` incident and cannot be recovered) is only **reported** — rename or delete it yourself in the
   Policy editor.
6. **Pending migration**: run `npm run migration:run` (uses the migration account) so
   `ReactivateImportCenterViewAction` is applied on each shared database, or leave `DB_MIGRATIONS_RUN` true.
7. **HTTPS and cookies.** The refresh cookie is `SameSite=Lax`. It is sent when the web app and the API are
   *same-site* — the DEV server (web `:3000`, API `:4000` on one host) and a local web + local API both
   qualify. It is **not** sent when a local web app calls the DEV API (different sites). For any cross-site or
   public deployment use HTTPS with `COOKIE_SAMESITE=none` (always Secure) or put both behind one origin
   (reverse proxy), and set `TRUST_PROXY` to the number of proxies in front of the API.
8. **When UAT / production environments are created:** new, independent secrets for each; `NODE_ENV=production`;
   explicit `CORS_ORIGINS`; `DB_MIGRATIONS_RUN=false` with the migration account; `SWAGGER_ENABLED` left unset.
9. **SUPER_ADMIN business-approval restriction (section 10).** The first API start with this code removes the
   nine business-approval codes from the SUPER_ADMIN system policy (a data change made by the boot sync, logged as
   `removed business-approval code(s)`); no migration is involved. Before and after deploying it to DEV, run
   `npm run maintenance:iam-audit` (read-only; exit code 2 = findings). It also lists anything the boot sync does
   **not** touch: a business-approval code in another policy attached to SUPER_ADMIN, in a SUPER_ADMIN holder's
   inline policy, or an active workflow level whose approver role is SUPER_ADMIN or no longer holds the approve
   permission — those need an administrator (edit/detach the policy, or publish the workflow again).
10. **Tell the SUPER_ADMIN users** that approvals now need a separate business account: any account that holds
    SUPER_ADMIN is refused every business approval, even if it also holds a business role.
11. **Open business decisions** (reversible, each a one-line change in `business-approval-actions.ts`):
    `REGISTRATION_APPROVAL_DEPOSIT_MANAGE` was left out of the restricted set (see section 10);
    `WORKFLOW_MANAGE_APPROVERS` stays with SUPER_ADMIN (it configures who approves, it approves nothing).

## 9. Known limitations

* Third-party credentials, database passwords and the DEV server cannot be changed from code (section 8).
* The first administrator's temporary password (`DEFAULT_ADMIN_PASSWORD`) is read from the environment by `BootstrapService` on a database that has never
  held a user (soft-deleted rows count); it is not needed at all with `BOOTSTRAP_SEED_ADMIN=false`, and should be removed from the environment once
  the first sign-in has replaced it (a production start warns while it is still there).
* The assignment boundary is checked when a role is handed out or an account's password is reset, not re-evaluated later; a delegated administrator can
  still deactivate, delete, edit, strip roles from and end the sessions of any non-SUPER_ADMIN account its permissions allow, including one with broader
  business permissions than its own (docs/ON_PREMISE_SUPER_ADMIN.md §4.3).
* Access tokens remain valid until they expire as bearer tokens — their lifetime is the session timeout (the `SESSION_TIMEOUT_MINUTES`
  attribute, 30–1440 minutes; `JWT_EXPIRES_IN` is only the JwtModule's default option and is not consulted) — but a deactivated user,
  revoked role or changed password-change flag is honoured on the very next request because it is re-read
  every time.

## 10. SUPER_ADMIN is a system administrator, not a business approver

**Rule.** `SUPER_ADMIN` manages users, roles, policies, configuration and the application. It never decides a
business transaction: it cannot approve or reject a tariff, billing cycle, bill run, registration request or meter
reading. Business roles do that. Every administrative, view and maker (submit/resubmit) permission stays.

**The restricted codes** (`src/modules/iam/business-approval-actions.ts` — the single source of truth):
`TARIFF_APPROVE`, `TARIFF_REJECT`, `BILLING_CYCLE_APPROVE`, `BILLING_CYCLE_REJECT`, `BILL_RUN_APPROVE` (gates
approve, reject and return), `BILL_RUN_HISTORICAL_APPROVE`, `APPROVE_REGISTRATION_REQUEST`,
`REJECT_REGISTRATION_REQUEST`, `METER_READING_APPROVE`. `business-approval-actions.spec.ts` reads the real permission
catalogue and fails if a code whose name contains `APPROV` or `REJECT` is neither restricted nor listed (with a
reason) as deliberately not an approval.

**Reviewed and deliberately not restricted:** `WORKFLOW_MANAGE_APPROVERS` (system configuration — chooses *which*
roles approve; SUPER_ADMIN just can never *be* one) and `REGISTRATION_APPROVAL_DEPOSIT_MANAGE` (deposit handling,
not an approve/reject decision; every route it gates also accepts `EDIT_REGISTRATION_REQUEST`, so moving it into
the set would change nothing at runtime — left for a business decision).

**Where it is enforced.** In the backend; the UI only mirrors it (the web app already hides Approve buttons using
the policy-based `GET /auth/me/actions`).

| Layer | What it does |
|---|---|
| `IamService.getActionCodesGrantedByPoliciesForRoles` — the one resolver behind `PermissionGuard`, `/auth/me/actions` and every service check | Drops the restricted codes for **any principal that holds the SUPER_ADMIN role**, whichever policy, inline policy or *other role* of that principal lists them. Decided on every request (the role is looked up by id and matched on the exact reserved name — a look-alike such as `Super_Admin` is not SUPER_ADMIN). |
| `IamService.ensureAdminPolicyGrants` (every boot) | Never grants the codes to the SUPER_ADMIN system policy **and strips them from it**, deleting a statement left empty, then re-reads the rows and throws if any remain. A restart, reseed or later migration therefore cannot restore them. No other role is touched (section 11). The system policy's stored description is brought in line with the rule. Another policy attached to SUPER_ADMIN is never edited by the sync; the boot logs a warning that lists the business-approval codes it holds (it does not name the policy — `npm run maintenance:iam-audit` does). |
| `RolePermissionsService.ensureAdminGrants` | The legacy tree is no longer re-granted the codes for SUPER_ADMIN on boot (existing legacy rows are left; see "Legacy architecture"). |
| Write guards (400 `SUPER_ADMIN is a system-administration role and cannot be granted business approval permissions (…)`) | `attachPolicyToRole` (to SUPER_ADMIN), `updatePolicy` (a policy attached to SUPER_ADMIN), role inline policy create/update (the SUPER_ADMIN role), user inline policy create/update (a SUPER_ADMIN holder). The resolver would ignore such a grant anyway; the guard stops anyone believing it took effect. |
| Workflow engine | `WorkflowDefinitionService.assertLevels` rejects SUPER_ADMIN as an approver (400, by name); the legacy advisory `updateApprovalPolicy` does too; `WorkflowOrchestrationService.assertCanAct` refuses any SUPER_ADMIN holder (403) — the SLA scheduler's system actor is unaffected. The no-self-approval checks (`assertNotSelfReview`) are untouched. |

**Dual-role users.** The strict rule was chosen: an account that holds SUPER_ADMIN *and* a business role is refused
every approval (otherwise an administrator could assign themselves a business role). Nobody locally held both. To approve,
use a separate non-SUPER_ADMIN account. Relaxing it to "only the SUPER_ADMIN role's own grants are ignored" is a
change inside `getActionCodesGrantedByPoliciesForRoles` only.

### Workflow approvers follow policies, not `role_permissions`

* One eligibility predicate — `IamService.getRoleIdsHoldingAnyAction` (via `RolePermissionsService`): a live role,
  not SUPER_ADMIN, whose attached policies or own inline policies grant one of the workflow's approve codes
  (`APPROVE_ACTION_CODES`, now declared in `business-approval-actions.ts` and re-exported by `workflow.service.ts`).
  It backs both the **Approver Role dropdown** (`GET workflow/definitions/:type/eligible-approver-roles`) and the
  **save-time check** (`PUT workflow/definitions/:type`), so the screen offers exactly what the backend accepts.
  Before: the dropdown read `role_permissions` and listed 2 / 3 / 0 roles for Tariff / Bill Run / Billing Cycle
  where 9 / 9 / 7 actually held the permission.
* `GET workflow/approval-flow/:type` is policy-based too. `PUT workflow/approval-flow/:type/approvers` is **retired**
  (410): it wrote inert `role_permissions` rows, no UI called it, and it let the two models drift apart.
* **A policy change cannot silently strand an approver.** Detaching a policy from a role, editing a managed policy,
  and editing or deleting a role's inline policy are refused with **409** — naming the role, level and workflow, and
  rolling the change back — when they would remove a workflow's approve code from a role that is a configured
  approver of an ACTIVE definition (`IamService.assertApproverEligibilityKept`, run inside the transaction against
  the post-change state; deleting a role that is a configured approver was already refused). Changes that touch no
  approve code run exactly as before; an approver that was already ineligible never blocks an unrelated edit.
* Configured levels, their order, SLA / on-breach behaviour and the SLA scheduler are untouched.

### Policy statement validation

All three policy kinds (managed, role inline, user inline) share `IamService.validateStatements` and the same
DTOs: an unknown resource, an unknown or **inactive** action code, a code that does not belong to the statement's
resource, and the same resource twice are all 400; `effect` is not accepted from a client (the global pipe rejects
the unknown field), every row is stored as `Allow`, and the resolver ignores any non-`Allow` row. **The database
itself enforces none of this**, and no constraint was added: a `UNIQUE (policy, resource)` or
`CHECK (effect = 'Allow')` migration would run on the next API start of every environment (`DB_MIGRATIONS_RUN`
defaults to true) and could stop the API booting where old rows violate it. Add them only after
`npm run maintenance:iam-audit` is clean on that environment. Existing records are checked by that script
(read-only) — locally it reports one known row (`policy_statements#101`, the `REPAIR_NEEDED_ORIGINAL_VALUE_LOST`
placeholder, repaired with `npm run maintenance:iam-policy-repair` after review).

### Legacy architecture — what is still used, and kept

| Piece | Status |
|---|---|
| `role_policies` → `policies` → `policy_statements`, role inline and user inline policies | **Source of truth** for every authorization decision. |
| `modules`, `sub_modules`, `screens`, `actions` | Active backbone: the action-code catalogue, nav catalog and seeds. Kept. |
| `role_permissions` | **Decides nothing.** Still feeds `/auth/context` `profile.permissions` (nav tree), the role edit page and role create (`/role-permissions/*`), the boot-time `ensureAdminGrants` (SUPER_ADMIN only), and `RoleService.remove`. **No longer read by the workflow screens or the approver checks.** Not dropped, not rewritten; existing SUPER_ADMIN rows for approval actions remain (inert). |
| `workflow_approval_levels`, `GET/PUT workflow/approval-policy/:type` | Legacy advisory record, drives nothing, no UI. Kept; SUPER_ADMIN can no longer be recorded in it. |
| `PUT workflow/approval-flow/:type/approvers` | Retired (410). Its web client (`setWorkflowApproversApi`, `useSetWorkflowApproversMutation`, the endpoint constant and the params type) was unused and was removed. |
| `SUPER_ADMIN_FORCE_TARIFF_ACTIVATION`, `SUPER_ADMIN_REVOKE_AFTER_CYCLE_CLOSE` system attributes | Defined in `attribute.service.ts`; no consumer was found (re-checked 2026-11-11 across the API and the web). **Left in place** — the decision to retire them is the owner's; see docs/PROPOSED_SCHEMA_CHANGES.md §3. |

### Verification (2026-11-04)

* API unit tests: 49 suites, all passing (the full suite). New: `business-approval-actions.spec.ts`,
  `iam-business-approval.spec.ts` (56 tests), `role-inline-policy.service.spec.ts`, `workflow/workflow-approvers.spec.ts`.
  The one `IamService` test that encoded the old "SUPER_ADMIN gets every action" rule was changed on purpose, and
  three specs that build a real `IamService` gained a `roles` mock.
* End to end on a **throwaway database** (a clone of the local schema and data, dropped afterwards) with a
  **separate API instance on :4100**: 63 of 63 checks. Nine approval routes answer 403 to SUPER_ADMIN and are not
  blocked for a business role; a dual-role account is refused and recovers on the next request; the boot sync strips
  the codes from an "old-state" system policy, a second restart rewrites nothing, and codes put back by hand are
  removed on the next start; the dropdown equals an independent SQL computation of the policy holders; publish
  rejects SUPER_ADMIN and ineligible roles and keeps level order; detach and policy edit on a configured approver
  answer 409 and leave the data unchanged; revocation shows in the dropdown on the next call; validation is
  identical for managed, role-inline and user-inline policies.
* The local development API (`--watch`) restarted on these code changes, so the local `ccb` database's SUPER_ADMIN
  system policy already lost the nine codes (85 → 76 distinct codes; nothing else changed).

## 11. SUPER_ADMIN is the only predefined role

**Rule.** `SUPER_ADMIN` is the ONLY static role. Every other role — whatever it is called — is created and managed
dynamically by `SUPER_ADMIN` through the application and lives only in the database. Nothing in the application's
runtime code (seed, boot-time grant syncs, guards, services, controllers) defines, seeds, reserves, auto-grants or
branches on a role by name, other than `SUPER_ADMIN`. Not covered: already-applied historical migrations (for example
`1792400000000-AddRegistrationApprovalDepositManageAction`, which granted one action to a role named
`CUSTOMER_SERVICE_SUPERVISOR` only if that role existed — a no-op on a fresh database, and it never creates a role),
and lookup labels such as the seeded `FIELD_INSPECTION_NOTIFY_ROLE` values, which are admin-editable LOV data, not roles.

| Where | Behaviour |
|---|---|
| `common/constants/global.ts` — `ROLES` | Contains `SUPER_ADMIN` only. |
| `bootstrap/seed-data.ts` — the seeded `ROLES` | A fresh database is seeded with the `SUPER_ADMIN` role only (and the one admin user — except with `BOOTSTRAP_SEED_ADMIN=false`, which seeds no account). No business role is ever created at startup. |
| `IamService.ensureAdminPolicyGrants`, `RolePermissionsService.ensureAdminGrants` | Serve `SUPER_ADMIN` alone: no ADMIN branch, and the ADMIN-only exclusion list (`ADMIN_GRANT_EXCLUDED_ACTION_CODES`) plus `ensureSuperAdminGrant`, which only compensated for it, were removed. |
| `RoleService` | `SUPER_ADMIN` is the only reserved name (create / rename / delete protection, canonical look-alike matching). A role called ADMIN — or anything else — is created, renamed, edited and deleted like any ordinary role. |
| Authorization | By the roles' attached policies (database), or `@Roles(SUPER_ADMIN)` on the SUPER_ADMIN-only structure routes. No other role name appears in a guard, decorator or condition. |

**Existing environments.** Nothing is deleted or rewritten: existing roles, role ids, user assignments and policies
stay exactly as they are. A role that an earlier install seeded by default (for example `FINANCE`, `OPERATIONS`,
`CUSTOMER_SUPPORT`, `CUSTOMER_SERVICE_EXECUTIVE`, `CUSTOMER_SERVICE_SUPERVISOR`, `CUSTOMER`) or an `ADMIN` role with
its "ADMIN Policy" simply becomes an ordinary role whose access is exactly the policies attached to it: the boot sync
no longer grants anything to an ADMIN role, and its name is no longer reserved. That "ADMIN Policy" was never flagged
system-managed, so it stays an ordinary, editable and deletable policy; it is just no longer kept in sync, and its
stored description (which says it is) is out of date. Review such roles in Roles & Permissions if you want to
rename, re-scope or retire them — no migration does it for you.

## 12. Administration permissions belong to SUPER_ADMIN alone

The Administration Console (users, roles, policies, system health, settings, audit, e-mail templates, invitations) is kept apart from the Business Application. The console screens that are `@Roles(SUPER_ADMIN)` routes have no permission code and cannot be granted. The ones that ALSO exist as grantable codes are *administration permissions* — `VIEW/CREATE/EDIT/DELETE_USER`, `RESET_USER_PASSWORD`, `VIEW/CREATE/EDIT/DELETE_ROLE`, the navigation-only `VIEW/CREATE/EDIT/DELETE_POLICY` and `VIEW_RESOURCE` — and only `SUPER_ADMIN` may hold them. The set is `src/modules/iam/administration-permissions.ts`, derived from the resource catalogue (the `USER` and `ROLE` resources plus the navigation-only codes).

| Layer | What it does | Where |
|---|---|---|
| Runtime | Drops the codes for any principal without `SUPER_ADMIN`, whatever policy, role-inline or user-inline policy lists them — so existing grants become inert on the next request, with no data change | `IamService.getActionCodesGrantedByPoliciesForRoles` |
| Policy writes | 400 for a managed, role-inline or user-inline policy that lists one; 400 for attaching a policy that lists one to any role but `SUPER_ADMIN` | `IamService.validateStatements`, `attachPolicyToRole` |
| Permission editor's tree | the System Admin pages and codes are not listed in the editor's tree (`GET /role-permissions/tree`, `/role/:id`) and cannot be saved (400) for any other role. The navigation catalog (`GET /auth/me/nav-catalog`) and a role's own legacy permissions are deliberately NOT filtered: every session's menu and links are built from them (an earlier version filtered them too and broke the Users / Roles links with a 404) | `RolePermissionsService.getPermissionTree(…, { forEditing: true })` |
| Visibility | `SUPER_ADMIN` is not in the role pickers / list / filter, and `SUPER_ADMIN` accounts are not in the Users list, detail or filter, for anyone but a super administrator | `RoleService`, `UserService` (+ their controllers) |
| Web | the Policy editor's resource picker leaves the Users and Roles resources out | `PolicyStatementCard.tsx` (`reservedForSuperAdmin`) |

Unchanged and still enforced: only a `SUPER_ADMIN` grants the role or touches a `SUPER_ADMIN` account; the last active and the initial `SUPER_ADMIN` are protected; the assignment boundary; the role cannot be created, renamed or deleted. Not reserved, by decision (2026-11-12): the personal Account settings, Approval Workflows, **System Attributes** and **Lookup Values** (business modules depend on them, so they stay assignable to authorized business roles) and every business resource — see ON_PREMISE_SUPER_ADMIN.md §3.1. Staff invitations and staff password resets are covered (they need the Users codes); invitations of portal customers follow the business customer permissions. Specs: `administration-permissions.spec.ts`, `iam-business-approval.spec.ts` (resolver, policy writes), `role-permissions.service.spec.ts`, the role and user specs. Nothing was run.
