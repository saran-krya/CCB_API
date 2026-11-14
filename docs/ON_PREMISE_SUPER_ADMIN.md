# CCB on-premises: the customer's SUPER_ADMIN, installation and upgrades

> **Status (2026-11-11): implemented in code, never compiled, run or tested** — the work was done under a "no tests, no builds, no servers, no SQL" order. Everything below says what the code is written to do and what still needs a decision. Nothing here was executed against any database.
> Companion documents: [VENDOR_MODULE_REMOVAL.md](VENDOR_MODULE_REMOVAL.md) (what was removed from the customer application and what was kept) and [PROPOSED_SCHEMA_CHANGES.md](PROPOSED_SCHEMA_CHANGES.md) (database changes that are **proposed, not made, and wait for approval**).

## 1. The model

CCB is software that is **developed and sold by CCB and run by the customer**. A customer (for example Azizi) installs it on its own infrastructure, operates it, backs it up and upgrades it. This repository contains **only that customer application**.

| Rule | Consequence in the code |
|---|---|
| One **independent installation per customer** | one API process, one web build, one database per customer |
| The customer owns **its own database** | no shared client database; **no `organization_id` / `tenant_id`** separates customers; CCB holds no credential for it |
| **Same source code for every customer** | nothing customer-specific is compiled in; behaviour differs only by configuration and by the customer's own data |
| CCB hosts and registers no one | the application contains **no** vendor portal, client registry, deployment / provisioning, licensing, support-operations or separate platform entry point — they were removed, not hidden ([VENDOR_MODULE_REMOVAL.md](VENDOR_MODULE_REMOVAL.md)) |

## 2. The role: `SUPER_ADMIN`

There is **one predefined role: `SUPER_ADMIN`** — the customer's own highest administrator, inside this installation only. There is no `GLOBAL_ADMIN` and no `CLIENT_ADMIN`; every other role is an ordinary role the `SUPER_ADMIN` creates in the application. The name is recognised in exactly one place (`src/common/security/administrator-roles.ts`), by **exact** match — a look-alike (`super_admin`, `SUPER_ADMİN`, …) is an ordinary role and never an administrator.

What a `SUPER_ADMIN` can do, with the console screen that does it:

| Capability | Where |
|---|---|
| Manage **all users** (create, edit, activate / deactivate, delete, reset passwords, end sessions) | Internal Administration → Internal Users |
| Create and manage **additional administrators** — delegated `ADMIN` accounts, or another `SUPER_ADMIN` | Internal Administration → Internal Users (§6) |
| Manage **roles and permissions** | Internal Administration → Roles & Permissions |
| Author and attach **policies** (including inline policies) | Internal Administration → Policies |
| **Business parameters** (the attributes) and **lookup values** | Platform Settings → Business Configuration → Business Parameters / Lookup Values |
| **Application settings** (brand colour, display and regional defaults, security policy, notifications, e-mail templates) | Platform Settings → Core → General Settings / Security Settings; Communication → Notification Settings / Email Templates |
| **System health** and **application information** | System Operations → System Health / Application Information |
| View the **audit log** | Audit & Compliance → Audit Logs |
| The installation's own **module catalog** (modules, screens, actions: rename, reorder, switch on / off) | Product Management → Module Catalog |
| Customer **business modules**, per the permissions it holds | the business application (it holds every action code **except the business-approval codes** — separation of duties) |

The console (layout, sidebar, breadcrumbs, Overview) is unchanged, except that the pages of Platform Settings are grouped into three categories — **Core**, **Communication** and **Business Configuration**. Its six sidebar groups are **Overview**, **Product Management**, **Internal Administration** (Internal Users, Roles & Permissions, Policies), **System Operations**, **Audit & Compliance** and **Platform Settings**. Its URLs still live under `/platform/…`; the Overview is the application root `/`, and the `/system-admin/…` pages are shared with the business application.

## 3. Who may do what

| | `SUPER_ADMIN` | Delegated administrator (`ADMIN`) | Every other user |
|---|---|---|---|
| What it is | the customer's **own highest administrator** | an ordinary dynamic role the `SUPER_ADMIN` creates (conventionally named `ADMIN`; "ADMIN 1", "ADMIN 2" are accounts that hold it) whose **policies** grant administrative permissions | accounts with business roles |
| Predefined / seeded | yes — created on a fresh database; **one default account** at first-time setup | **no** — never seeded, never special in code | no |
| Create / edit users, assign ordinary roles | yes | **no** — `CREATE_USER`, `EDIT_USER`, `DELETE_USER` and the other Users / Roles permissions are *administration permissions* that only `SUPER_ADMIN` can hold (§3.1). The assignment boundary (§4.2) stays in force behind that rule | no |
| Create **another administrator** | yes (an `ADMIN` account, or another `SUPER_ADMIN`) | **no** (§3.1) — and **never a `SUPER_ADMIN`**, whatever it holds | no |
| Grant or take away the `SUPER_ADMIN` role; edit the role's description; touch a `SUPER_ADMIN` account (profile, deactivate, delete, reset password, revoke sessions) | yes (never the last active one, never the initial one, never its own roles) | **no — refused with 403, whatever permissions it holds** | no |
| Delete or rename the `SUPER_ADMIN` role, or rename another role into that name | **nobody** — delete: 409 for every actor; rename: 409 for a `SUPER_ADMIN` | **nobody** — 403 | **nobody** |
| Reset the password of another account (a login for it) | yes | **no** — `RESET_USER_PASSWORD` is an administration permission (§3.1) | no |
| Author policies, inline policies, the resource catalog, role-permission trees | yes | **no** — these routes are `@Roles(SUPER_ADMIN)`, not a delegable permission | no |
| System settings, audit trail, system health | yes | **no** — `SUPER_ADMIN`-only routes | no |
| Approve tariffs, billing cycles, bill runs, registrations, meter readings | **never** | only if a policy grants it to a business role it holds | per policy |

**Where it is enforced (backend — the web only mirrors it):**

| Rule | Enforced in |
|---|---|
| The role name is recognised by **exact** match only | `common/security/administrator-roles.ts` |
| `SUPER_ADMIN` passes every `@Roles(...)` check; a role merely called `ADMIN` does not | `common/guards/roles.guard.ts` (live role names re-read per request, never the JWT claim) |
| Only a `SUPER_ADMIN` (or the boot-time system) may **grant** the role or **modify** a holder's roles; nobody may change their **own** roles; a user keeps ≥ 1 role | `UserRoleService.addRolesToUser` / `removeRoleFromUser` (one transaction; a removal takes row locks, a grant relies on the unique key) |
| Only a `SUPER_ADMIN` may edit, deactivate, delete, reset the password of, or end the sessions of a `SUPER_ADMIN` account | `UserService`, `AuthService`, `UserRoleService.assertActorMayModifyUser` |
| The **last active** `SUPER_ADMIN` and the **initial** `SUPER_ADMIN` can never be demoted, deactivated, deleted or locked out; the **initial** `SUPER_ADMIN` additionally can never have its password reset or e-mail changed, by anyone (M10) | `UserRoleService.assertNotLastActiveAdministrator` / `assertNotInitialAdministrator` / `removeRoleFromUser`; `AuthService.disableSigninAccess` / `adminResetPassword`; `UserService.update` (§4.1) |
| **Assignment boundary** — a delegated administrator cannot grant permissions it does not hold, by a role or by taking over an account | `AssignmentBoundaryService`, called from `UserRoleService.addRolesToUser` — the single choke point every grant goes through — and, for a password reset, from `AuthService.adminResetPassword` via `UserRoleService.assertActorMayTakeOverAccount` (§4.2) |
| The role cannot be created, renamed into, renamed away from or deleted; look-alike spellings are reserved too | `RoleService` (`RESERVED_ROLE_NAMES`, `canonicalRoleName`) |
| The role pickers, the Roles list and the Users list / detail / filters **do not show** the `SUPER_ADMIN` role, or any `SUPER_ADMIN` account, to anyone but a super administrator (a role the viewer may not assign is, as a second line of defence, still flagged `assignable: false`) | `RoleService.hideAdministratorRoles` behind `getRoleDropdown` / `getRolePicker` / `getRoleFilter` / `RoleLists` / `findOneVisibleTo`; `UserService.findAll` / `findOne` / `getFilterOptions`; the flag is mirrored by `lib/utils/role-picker.util.ts` |
| **Administration permissions** (§3.1) are never held by any principal without `SUPER_ADMIN`, whichever policy lists them | `IamService.getActionCodesGrantedByPoliciesForRoles` — the one place every authorization read passes through |
| …cannot be written into a managed, role-inline or user-inline policy, or attached to any role but `SUPER_ADMIN` | `IamService.validateStatements`, `attachPolicyToRole` (400) |
| …cannot be ticked in the permission **editor's** tree (`GET /role-permissions/tree`, `/role/:id`) or saved from it for any other role. The navigation catalog (`GET /auth/me/nav-catalog`) and a role's own legacy permissions are **not** filtered — every session's menu, breadcrumbs and links are built from them | `RolePermissionsService.getPermissionTree(…, { forEditing: true })` / `savePermissions` / `updateRolePermissions` / `create` |
| …are not offered by the Policy editor | `IamService.findAllResourcesWithActions` (`reservedForSuperAdmin`), `PolicyStatementCard.tsx` |
| Business-approval codes are never held by, and never attachable to, the administrator role; it can never be a workflow approver | `IamService`, `WorkflowService` / `WorkflowDefinitionService`, `WorkflowOrchestrationService` |
| The administrator's system policy is kept in step with the catalogue on every start | `IamService.ensureAdminPolicyGrants`, `RolePermissionsService.ensureAdminGrants` |

### 3.1 Administration permissions — `SUPER_ADMIN` alone

The Administration Console and the CCB Business Application are kept apart. Every console screen that is already a `@Roles(SUPER_ADMIN)` route has no permission code at all and cannot be granted (Platform Overview, Module Catalog, System Health, Application Information, Audit Logs, Platform Settings, E-mail Templates, the policy and resource catalogues). The console screens that *also* exist as grantable codes are **administration permissions** and belong to `SUPER_ADMIN` alone:

| Console screen | Codes |
|---|---|
| Internal Users (and the staff invitations and password resets that ride on it) | `VIEW_USER`, `CREATE_USER`, `EDIT_USER`, `DELETE_USER`, `RESET_USER_PASSWORD` |
| Roles & Permissions | `VIEW_ROLE`, `CREATE_ROLE`, `EDIT_ROLE`, `DELETE_ROLE` |
| Policies, Resources (navigation-only codes) | `VIEW_POLICY`, `CREATE_POLICY`, `EDIT_POLICY`, `DELETE_POLICY`, `VIEW_RESOURCE` |

The list lives in one place, `src/modules/iam/administration-permissions.ts`, and is **derived from the resource catalogue** (everything in the `USER` and `ROLE` resources plus the navigation-only codes), so an action added to those resources later is protected without anyone listing it. `SUPER_ADMIN` holds them through its system policy, which is synced from the catalogue and never goes through the write guards below.

- **Enforced at runtime, with no data change:** the permission resolver drops them for any principal that does not hold `SUPER_ADMIN`. A grant made before this rule existed (an "ADMIN" role whose policy lists `CREATE_USER`) therefore stops working on the next request; nothing is rewritten, and the policy can still be edited to remove the codes.
- **Refused at write time (400):** a managed, role-inline or user-inline policy that lists one; attaching a policy that lists one to any role but `SUPER_ADMIN`; saving one for another role from the permission editor.
- **Not shown:** the Policy editor's resource picker leaves the Users and Roles resources out, and the permission editor's tree of any other role does not contain the System Admin pages for them (the navigation catalog itself stays complete — it holds no authorization, only structure). `SUPER_ADMIN` is not offered by the role pickers, and `SUPER_ADMIN` accounts are not listed, to anyone but a super administrator.
- **Deliberately delegable — decided 2026-11-12:** **System Attributes** (`VIEW_ATTRIBUTE`, `EDIT_ATTRIBUTE`) and **Lookup Values** (`LOV_VIEW`, `LOV_CREATE`, `LOV_EDIT`, `LOV_DELETE`, `LOV_MODULE_ASSIGN`) **stay assignable to authorized business roles**. They are listed under the console's *Platform Settings* group, but business modules depend on them, so they are **not** administration permissions and nothing in this section touches them. The same holds for the personal Account settings (every user manages their own profile and password), Approval Workflows and every business resource. `administration-permissions.spec.ts` pins the decision (it fails if the `ATTRIBUTE` or `LOV` resource is added to the protected set).
- **Invitations and password resets:** the staff side is `SUPER_ADMIN`-only — issuing, re-sending, cancelling and listing a **staff** invitation, and resetting a staff password, all need the Users codes (`CREATE_USER`, `EDIT_USER`, `VIEW_USER`, `RESET_USER_PASSWORD`). Invitations of **portal customers** are customer operations and follow the business customer permissions (`VIEW_CUSTOMER`, `EDIT_CUSTOMER`); that is unchanged.
- **What this means for "ADMIN":** a delegated `ADMIN` is an ordinary *business* role — it can no longer manage users, roles or policies, however it is configured. The assignment boundary (§4.2) and the other account protections below are kept as defence in depth; with these permissions reserved they cannot be reached by a delegated role.

## 4. Administrator security

### 4.1 The protected initial `SUPER_ADMIN`

The installation's **initial administrator** is the **lowest-id active, non-deleted holder** of `SUPER_ADMIN` — the account the first start (or the maintenance tool) created first. It is **derived from the data**, so it needs no marker column and no migration.

Through the application it can **never be deleted, deactivated, demoted (the role removed), have its sign-in disabled, have its password reset, or have its e-mail address changed** — by anyone, including another `SUPER_ADMIN` — even while other administrators exist (HTTP 403: *"Cannot … the initial SUPER_ADMIN account — it is protected so that an installation can never lose its owner by accident. To hand it over, use the server maintenance tool"*). On top of that, the existing rule stays: **the last active `SUPER_ADMIN` can never be removed**, whoever it is.

**(M10, resolved 2026-11-14 — previously open, §11 item 6):** a password reset or an e-mail change used to be treated as merely "looking after" the account, not "losing" it — but either one hands whoever performs it a path to the owner's identity (a reset is a fully working login; an e-mail change redirects where a future password-recovery or notification goes), and `assertActorMayModifyUser`/`assertActorMayTakeOverAccount` both exempt every `SUPER_ADMIN` actor unconditionally, including a peer with no other relationship to the owner account. Both are now guarded the same way deletion/deactivation/demotion/sign-in-disabling always were (`AuthService.adminResetPassword`, `UserService.update`, both calling `UserRoleService.assertNotInitialAdministrator`). What is still deliberately **not** blocked: editing the initial administrator's other profile fields (name, mobile, designation, …) by another `SUPER_ADMIN` — only a path to the owner's identity is guarded, not routine upkeep.

**Handing it over** is a deliberate step on the server (§7): `npm run maintenance:super-admin -- --retire --email …` deactivates the account, clears its password and ends its sessions, and only when another active `SUPER_ADMIN` who can sign in exists. The protection then passes, by itself, to the oldest remaining active administrator. Because "initial" always means *the oldest ACTIVE holder*, re-activating an older retired account would make it the initial one again (and the one that moved up would lose the protection) — which is why a retire also clears the password: a re-activated ex-administrator has no working credentials until a `SUPER_ADMIN` sets a new password.

### 4.2 The assignment boundary

Handing a role to a user hands out everything the role grants. Because `CREATE_USER` and `EDIT_USER` (which gates adding and removing roles; "ASSIGN_ROLE" is only the name of the audit row) are delegable, an administrator holding only those could otherwise give any account an ordinary role *broader than its own* — and so, through a second account, grant itself more than it was ever given. The boundary closes that:

> **A delegated administrator may assign a role only if every permission the role grants is a permission the administrator holds itself, right now.**

* "Holds" is computed exactly as authorization is: the union of the Allow codes of the policies and inline policies of the actor's **current** roles plus the actor's own inline policies, read live (never from a token, never cached).
* "Grants" is the role's attached policies plus the role's own inline policies.
* A role that grants nothing is always assignable. A refused request assigns **nothing** (the whole request fails with 403 naming the role and up to five missing permissions).
* A `SUPER_ADMIN` and the boot-time system are unbounded.
* **Taking over an account is the same grant by another route.** `RESET_USER_PASSWORD` is delegable too, and a reset hands the actor a working login for the account. So a delegated administrator may reset the password of an account **only if every permission that account holds is one the administrator holds itself** (the account's own inline policies count). Without this, the boundary on roles could be walked around by resetting a more privileged user's password and signing in as them. The refusal names no permission; nobody is "beyond" their own account; a `SUPER_ADMIN` account can only be reset by a `SUPER_ADMIN` in any case.
* Policy authoring is not delegable at all (`@Roles(SUPER_ADMIN)`), so *assigning roles* and *taking over accounts* are the only ways a delegated administrator could ever widen anyone's access — and those are the paths the boundary covers. Roles are checked in the one method every grant passes through (`UserRoleService.addRolesToUser`: create user with roles, add roles, bootstrap); the reset is checked in `AuthService.adminResetPassword`. Neither check is in a controller.
* The **role** checks read on the caller's transaction connection (the actor's role rows, the policies, the inline policies), so the check and the grant see the same rows and the transaction never waits for a second pool connection. The password-reset check reads on the pool and is not atomic with the write that follows (see §4.3).
* The pickers show a role beyond the viewer's scope **disabled, with the reason** *"This role grants permissions you do not hold."*

### 4.3 What the protections do not cover

* The boundary is checked **when a role is handed out or a password is reset**. A role whose policies are widened *afterwards* (only a `SUPER_ADMIN` can do that), or an administrator whose own permissions are later reduced, does not change roles that were already assigned — review such roles when you change policies.
* **It is not a wall around higher accounts.** A delegated administrator can still, within the permissions it was given, edit, deactivate, delete, strip roles from, disable the sign-in of and end the sessions of any non-`SUPER_ADMIN` account — including one with broader business permissions than its own. Those are denial actions, not grants, and they stay governed by `EDIT_USER`, `DELETE_USER` and their siblings; only *taking over* an account is bounded. Give those permissions to a delegated administrator accordingly.
* Two delegated administrators can pass each other roles that are each within what the giver holds; the boundary limits a giver to its own permissions, not the pair.
* A refusal says which role is beyond the actor's scope and names up to five of the missing permissions, so the administrator can ask a `SUPER_ADMIN` for them. That does show a delegated administrator part of what a role grants; the account refusal names none.
* The existing "is this a `SUPER_ADMIN` account?" check on edit / delete runs just before the transaction, not under its locks, so a very narrow window exists in which an account that is promoted at that moment can still be touched by a delegated administrator.
* **A chain to be aware of.** Because stripping a role is not bounded (above), a delegated administrator can remove from a more privileged account the roles that put it beyond the administrator's scope and *then* reset its password — the reset check sees the account's remaining permissions, which now fit. The administrator ends up signing in as that account with **only permissions it already held itself** (impersonation, not escalation), and the account's real holder has lost the removed roles. Decision §11.7 would close it.
* **A reset leaves the administrator a working login.** The check is made at the moment of the reset, and the administrator may choose the new password (and `mustChangePassword`). Until the real holder has changed it, the administrator can sign in as that account — and if a `SUPER_ADMIN` later widens the account's roles, that login gets the extra permissions too. Treat a reset as "shared until the holder has changed the password": have the holder change it at once (the default forces a change at the next sign-in).
* The password-reset check and the write that follows are not one transaction: a second, broader administrator widening the account in that instant could make a reset pass on the old permissions. It needs two cooperating administrators.
* The in-application rules for the **last** and the **initial** administrator count *active* holders; they do not check that a holder can sign in (an administrator whose sign-in access was disabled still counts). The maintenance tool's `--retire` is stricter (it needs another administrator who is active **and** has a password). Do not disable the sign-in of administrators you rely on.
* A refused reset tells the administrator only that the account holds permissions it lacks: ask a `SUPER_ADMIN` to do the reset, or to widen the administrator's policy.
* "Initial administrator" means *the oldest active holder*. A `SUPER_ADMIN` created later is not protected while an older active one exists. A direct change to the database bypasses every application rule — that is the owner's prerogative and is why §7 exists.
* Nothing requires a second person to approve the creation of a `SUPER_ADMIN`.

## 5. First-time installation

1. **Database.** An empty MySQL database owned by the customer. Optionally two accounts (`scripts/db/provision-db-users.sql`): a runtime account and a DDL-capable one (`DB_MIGRATION_USERNAME` / `DB_MIGRATION_PASSWORD`).
2. **Environment** (the installer's file; never committed). Required: `NODE_ENV=production`, `JWT_SECRET` (≥ 32 random characters), `DB_*`, `CORS_ORIGINS`. Choose **one** way to create the first administrator:
   * **A — temporary password in the environment** (the default): `DEFAULT_ADMIN_EMAIL` = the **real address of the person who will administer the installation** (*production refuses an unset value and the built-in example `admin@ccb.local`*), `DEFAULT_ADMIN_NAME`, `DEFAULT_ADMIN_PASSWORD` (policy: ≥ 12 characters, 3 of 4 character classes). It is only a **temporary** password.
   * **B — no password in any file:** set `BOOTSTRAP_SEED_ADMIN=false` and **delete the `DEFAULT_ADMIN_PASSWORD` line** of the template (a production start refuses its placeholder). The first start seeds the `SUPER_ADMIN` role and **no account**; then run on the server `npm run maintenance:super-admin -- --email … --name "…" --apply` (§7), which prints a one-time password once.
3. **Sample data stays off.** Leave `BOOTSTRAP_SEED_DEMO_DATA` unset. The first start can also load one estate's sample Community / Property / Unit data (8 / 67 / 111); a customer installation must **not** start with it, so it is **never loaded in production unless `BOOTSTRAP_SEED_DEMO_DATA=true`** (a demo or training installation). Unset: loaded on a developer machine and in tests only; `false`: never.
4. **Start the API once.** The baseline migration builds the schema; `BootstrapService` decides what kind of start it is **by whether the database has ever held a user** (soft-deleted and deactivated accounts count):
   * **no user row at all → fresh:** in one transaction it seeds the navigation catalogue, actions, lists of values, attributes, the `SUPER_ADMIN` role and **the installation's one default administrator account** (path A) — plus the sample data only if enabled (step 3); then the IAM synchronisation.
   * **any user row → initialized:** the seed **never runs again**, so a repeated start can never create a second default administrator (the e-mail is also unique across deleted rows). Only idempotent backfills run: no role, user, custom policy or account is renamed or rewritten; the one thing every start re-synchronises is the **system-managed `SUPER_ADMIN` policy** (missing action codes added, business-approval codes stripped, description refreshed), exactly as before this release. Do not start several instances at once on a brand-new database.
5. **The administrator sets their own password.** The account is created with `must_change_password`; the sign-in answers with `mustChangePassword`, the web goes to `/force-password-change`, and the API (`PasswordChangeGuard`) refuses every other route until the holder has chosen a new password. The person who installed the system therefore never knows the password the administrator keeps.
6. **Remove `DEFAULT_ADMIN_PASSWORD` from the environment** and restart. A production start that still finds it logs a warning.
7. **Create a second `SUPER_ADMIN`** (two named people, no shared account) and the delegated administrators (§6).

**What a fresh production database contains:** the navigation catalogue and actions, lists of values, system attributes, the `SUPER_ADMIN` role with its system policy, and the one administrator account of step 2 — **no demo account, no sample business data**. The only seeded account needs a real address, has a temporary password that must be changed, and is never recreated.

**Not covered here:** e-mail invitations ("set your password through a link", for staff and customers) and the managed e-mail templates are a separate feature, **active since 2026-11-12** (staff invitations are `SUPER_ADMIN`-only) — see [INVITATIONS_AND_EMAIL_TEMPLATES.md](INVITATIONS_AND_EMAIL_TEMPLATES.md) and [PROPOSED_SCHEMA_CHANGES.md](PROPOSED_SCHEMA_CHANGES.md).

## 6. Creating additional administrators

With the screens that already exist (`SUPER_ADMIN` signed in):

> **Changed (§3.1):** user, role and policy management are *administration permissions*. An `ADMIN` role is an ordinary **business** role — it can be given customer, community, meter, billing or finance permissions, never these. Whoever has to administer users and roles is given `SUPER_ADMIN` itself (step 4).

1. **System Admin → Roles → Create Role** — name it `ADMIN`, `MANAGER`, `STAFF` … (any name except `SUPER_ADMIN` and its look-alikes). It starts with **no permissions**.
2. **System Admin → Policies / Roles → Attach Policy** — attach the policies that carry the **business** permissions the role should hold. Only a `SUPER_ADMIN` can author or attach policies, and a policy that lists an administration permission is refused (400), so no business role can ever be widened into the console.
3. **System Admin → Users → Create User** — choose the business role. The wizard defaults to *"must create a new password at first sign-in"*, so the new user chooses their own password.
4. To create **another `SUPER_ADMIN`**, pick the `SUPER_ADMIN` role in the same wizard — it is offered only to a `SUPER_ADMIN`; for anyone else it is not in the list at all.

Result: `SUPER_ADMIN` = the installation's owner role and the only holder of the administration console; every other role (`ADMIN` included) = exactly the business permissions its policies say.

*Older installations.* A policy written before this rule may still list `CREATE_USER` and similar codes for an `ADMIN` role. Nothing is rewritten: the codes simply stop working on the next request, the policy cannot be re-attached to another role, and editing the policy to remove the codes (Policies → Edit) is accepted. Review such roles in Roles & Permissions.

## 7. The server maintenance tool — first administrator, recovery, hand-over

Run **on the server**, by the person who owns it (it needs the database credentials in the environment file). It is not a web route, so nobody who can merely reach the application can use it. **Dry run by default** — nothing changes without `--apply`; take a backup of a shared database first.

```
cd "CCB API"
# APP_ENV picks the environment file (unset = .env, "dev" = .env.dev, any other name = .env.<name>). The FIRST line the tool prints is
# "[typeorm-cli] <file> -> user@host/database" — read it before --apply. `npm run maintenance:super-admin` runs through ts-node (dev dependencies); on a
# server that only has the build use the compiled twin: `npm run maintenance:super-admin:prod -- …` (node dist/scripts/maintenance/super-admin.js).
APP_ENV=<env> npm run maintenance:super-admin -- --list                                              # who holds SUPER_ADMIN (read-only)

# create the first administrator, or recover one (activate, new temporary password, sessions ended, SUPER_ADMIN ensured)
npm run maintenance:super-admin -- --email it.lead@customer.example --name "Grace Hopper"           # dry run
npm run maintenance:super-admin -- --email it.lead@customer.example --name "Grace Hopper" --apply   # do it

# hand over: retire one administrator account (typically the initial one) — only when another active SUPER_ADMIN exists
npm run maintenance:super-admin -- --retire --email grace@customer.example                          # dry run
npm run maintenance:super-admin -- --retire --email grace@customer.example --apply                  # do it
```

* **Create / recover:** for one account, in one transaction — creates it if missing (never touches a **deleted** one), activates it, sets a **random temporary password** (printed once to the terminal, stored nowhere in clear text) that must be replaced at the first sign-in, ends the live sessions of an existing account, makes sure it holds `SUPER_ADMIN`, writes one audit row (`SUPER_ADMIN_RECOVERY`; no e-mail, no password in it). It refuses when the `SUPER_ADMIN` role does not exist.
* **Retire:** deactivates the account, clears its password and ends its sessions in one transaction that first locks every active `SUPER_ADMIN`; **refuses when no other administrator would remain who is active AND can sign in** (has a password — `--list` marks an administrator without one); the account is not deleted and keeps its roles; writes one audit row (`SUPER_ADMIN_RETIRED`). When the account was the initial administrator, the protection passes to the oldest remaining active one.
* It never deletes anyone and never removes a role.
* **A locked-out administrator** (too many failed sign-ins) does not need this tool in the first place: the lock is per client address, so the owner signs in from where they always do, and another administrator can *Unlock sign-in*. When nobody can sign in at all, `npm run maintenance:unlock-signin -- --email <address> --apply` (compiled: `maintenance:unlock-signin:prod`) clears the failed-attempt counters of that account from the server; see docs/OPERATIONS.md, "Sign-in lock-out".

If an **initialized** database has no `SUPER_ADMIN` role row at all (it was renamed or removed by hand), the application **does not seed on its own** — an initialized database is never re-seeded — and the tool refuses; the role row has to be restored first ([PROPOSED_SCHEMA_CHANGES.md](PROPOSED_SCHEMA_CHANGES.md), §4). On a database that has **never** held a user, one start of the application seeds the role.

## 8. Database ownership, isolation and upgrades

* **Ownership.** The customer's database, server, backups and credentials are the customer's. CCB has no account in it and no network path to it. Two installations share nothing: not a database, not a secret (`JWT_SECRET`, cookie name, Redis and CORS origins are per installation), not a user.
* **Isolation.** Isolation is the *installation* boundary, not a row filter: a `SUPER_ADMIN` exists only in its own database, and the code contains no cross-installation lookup.
* **Upgrading — the customer's responsibility, with CCB's release notes.** Take a backup; deploy the new build; migrations run at start unless `DB_MIGRATIONS_RUN=false`, in which case run `APP_ENV=<env> npm run migration:run` with the DDL account first (the CLI prints the target database; like the maintenance tool it needs the dev dependencies); start the API (idempotent backfills run); sign in. Every release must list its migrations and any data conversion. Rolling back = restoring the backup.
* **CCB's responsibility.** Ship releases, migration scripts and release notes; keep every migration and backfill idempotent (the existing convention); never require a connection from CCB to the customer.
* **Migrations stay explicit.** A file in `src/migrations/` runs on the next start of any installation that has `DB_MIGRATIONS_RUN` on, so schema changes are written up in [PROPOSED_SCHEMA_CHANGES.md](PROPOSED_SCHEMA_CHANGES.md) first and only become migrations when approved.

## 9. Existing installations — nothing is converted

The role keeps its name, `SUPER_ADMIN`. **No existing role, user, custom policy or account is renamed or rewritten by a start.** (As on every start before this release, the system-managed `SUPER_ADMIN` policy is re-synchronised with the catalogue.) An installation created before this change keeps working as it is; it gains the protected initial administrator and the assignment boundary (both derived at run time, no schema), and the console without its vendor screens.

**Symptom to know about: "my administrator now sees the business sidebar, not the console".** The administration console is chosen by the role **name**: the web shows it only to a session whose role list contains exactly `SUPER_ADMIN`; every other session keeps the business layout. If an installation ever ran the interim, never-released build that renamed the administrator role (for example to `GLOBAL_ADMIN`) and has since moved to this release, its administrator holds a role the application no longer recognises — so it gets the business layout (and the `SUPER_ADMIN`-only routes answer 403). To confirm, open the browser's developer tools, look at the response of `GET /auth/context` and read `profile.roles[].name`; to repair, restore the name with the statements in [PROPOSED_SCHEMA_CHANGES.md](PROPOSED_SCHEMA_CHANGES.md) §4 (they are documented there and were never run by this project). Then sign in again.

## 10. Modules in this release

| Area | State |
|---|---|
| Administration console: Platform Overview, Module Catalog, Internal Users, Roles & Permissions, Policies, System Health, Application Information, Audit Logs, and Platform Settings (General Settings — which now also holds the regional defaults — Security Settings, Notification Settings, Email Templates, Business Parameters, Lookup Values) | **Kept** — Platform Settings only reorganised: no setting, route or permission was removed |
| Overview content | operational alerts (database down, cache down), the installation's own health, latest administrative activity — nothing about other customers or the business data. The API still computes four user-administration conditions (no active `SUPER_ADMIN`, a single one, a pending first password, never signed in); the Overview and the notification bell do **not** show them |
| Client Registry, Register Client, client lifecycle, Deployment Management / Status, provisioning, Licensing & Renewals, Support Operations / History, the initial-admin invitation workflow, the platform entry point and its environment | **Removed** — [VENDOR_MODULE_REMOVAL.md](VENDOR_MODULE_REMOVAL.md) |
| Business application (communities, meters, billing, workflows, …) | **Untouched** |

## 11. Pending decisions and approvals

1. **Schema:** this release changed nothing; the `account_invitations` and `email_templates` tables (e-mail invitations and their templates) were approved and created separately on 2026-11-12. An optional stored "installation owner" marker is not needed today — the owner is derived. → [PROPOSED_SCHEMA_CHANGES.md](PROPOSED_SCHEMA_CHANGES.md).
2. **`SUPER_ADMIN_*` attributes:** reviewed, **not retired** — two seeded system attributes carry the role's name but nothing reads their value. → same document, §3.
3. **A predefined empty `ADMIN` role** shipped in the seed? Not done: only the top administrator role is predefined.
4. **Invitations:** done and verified (see [INVITATIONS_AND_EMAIL_TEMPLATES.md](INVITATIONS_AND_EMAIL_TEMPLATES.md)); each installation needs its own SMTP settings, portal address and e-mail branding.
5. **Licensing:** does the customer product need its own license viewer / enforcement? (Nothing exists; the former vendor-side licensing was removed.)
6. ~~**Initial administrator, stricter?** Today another `SUPER_ADMIN` can still reset the initial administrator's password or change its e-mail (it is "looking after" the account, not losing it). Should those also need the server tool?~~ **Resolved 2026-11-14 (M10):** both are now blocked for anyone but the server maintenance tool — see §4.1.
7. **Delegated administrators and higher accounts:** should a delegated administrator also be unable to deactivate, delete, strip roles from or end the sessions of an account whose permissions exceed its own (§4.3)? Today only taking over (a password reset) is bounded — which also leaves the "strip a role, then reset" chain of §4.3 open.
