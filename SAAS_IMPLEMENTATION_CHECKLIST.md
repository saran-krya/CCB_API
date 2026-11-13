# CCB Multi-Tenant SaaS — Implementation Checklist

> ## STATUS: PAUSED AND REVERTED (2026-11-10)
>
> **Decision changed: no SaaS multi-tenancy for now.** Phases A–D are removed from the CCB API working tree, which is restored to the pre-Phase-A architecture and schema definition (baseline = commit `841a2f82`). CCB_Web never received any SaaS code. **Nothing below this banner exists in the codebase** — it is kept only as a historical record of what was built and removed. Do not resume from it without a new explicit decision.
>
> **Reverted (all of it):**
> - `Organization`, `SubscriptionPlan`, `UserInvitation` entities; `OrganizationService`, `SubscriptionPlanService`, `OrganizationController` (`/platform/organizations`), DTOs, `OrganizationModule` (`src/modules/organization/`)
> - `organization_id` on 22 existing entities + `AuditLog`; the unique-index changes on `Role.roleName` / `Policy.name` (back to the original global unique)
> - 9 migrations `1794400000000` … `1795200000000` (plans, organizations, invitations, demo-org seed, add columns, backfill, FKs, NOT NULL, org-scoped uniques)
> - Tenant context: `nestjs-cls` + `ClsModule`, `OrganizationContextService/Module`, `OrganizationContextGuard`, `OrganizationStatusGuard`, `@AllowSuspendedOrg()`, the two extra `APP_GUARD`s, `organizationId` on `AuthenticatedUser` / `AuthenticatedCustomer`, `JwtStrategy`'s live org resolution, `UserService.findAuthState` / `CustomerService.findAuthState` org additions
> - Org-scoped RBAC: `RoleService`, `IamService`, inline-policy services, `UserRoleService` (cross-org role grants, last-active-org-ADMIN protection), plus their spec changes and the 5 SaaS-only spec files
> - SaaS error-message / audit constants and the `nestjs-cls` dependency in `package.json` / `package-lock.json`
> - Phase E isolation work was never present in the repository (nothing to revert). Phases F–K were never started.
>
> **Deliberately kept (not SaaS, committed in the same commits):** the Global Search module (`src/modules/global-search/`, its registration in `app.module.ts`, `search-text.util`, `label.util`) and a comment-only edit to migration `1789983744793-AddFieldInspectionRequests.ts`. CCB_Web's Global Search UI commit is also untouched.
>
> **Database — not reverted by this change (needs an explicit decision):** the local `ccb` DB currently holds three leftover SaaS tables (`organizations` with 1 row, `subscription_plans`, `user_invitations`) and 9 rows in `migrations` (ids 61–69, names `*1794400000000` … `*1795200000000`). The `organization_id` columns on business tables are not present. The reverted code ignores the leftovers. No SQL write was run by the revert itself; the SaaS migrations were auto-run by the watch-mode API when it restarted (stale compiled migrations in `dist/`, since deleted). Any other environment that pulled the SaaS commits and booted with migrations enabled needs the same check.
>
> **Recoverable:** the SaaS code remains in git history (commits `8439e593`, `9bf17b7a`, `9ebdbb9a` on `main`); nothing was reset or force-pushed. Reverted files are working-tree changes, not committed.
>
> **Verification at revert time:** `tsc --noEmit` — 4 errors, all pre-existing (`jwt.strategy.spec.ts`, `live-role-authorization.spec.ts`: `JwtStrategy` takes 4 constructor args, specs pass 3; both files identical to baseline). `nest build` clean. Jest: 943 tests pass, same 2 pre-existing suites fail to compile. No SaaS references remain in API `src`/`test`/`scripts`/`docs` or in CCB_Web.

---
## SUPER_ADMIN platform administration (normal CCB — NOT SaaS) — status 2026-11-10

> **UPDATE 2026-11-11 — the vendor part of this section no longer exists in the codebase.** CCB is on-premises software: every customer runs its own installation, and its `SUPER_ADMIN` is the customer's own highest administrator. The client registry, client lifecycle, deployments / provisioning, licences & renewals, support operations, the initial-admin invitation workflow and the separate platform entry point (everything under "Built, NOT activated" below) were **completely removed** from the customer application, not just hidden. What stays is the administration console itself (Overview, Module Catalog, Users / Roles / Policies, System Health, Application Information, Audit Logs, Settings, System Attributes, Lookup Values). What was removed, what was kept and why, and where the only copy of the removed files sits: [docs/VENDOR_MODULE_REMOVAL.md](docs/VENDOR_MODULE_REMOVAL.md). The model: [docs/ON_PREMISE_SUPER_ADMIN.md](docs/ON_PREMISE_SUPER_ADMIN.md). The "unbuilt items shown disabled as Planned" and "9 groups" remarks below are history: the console has no disabled entries and 6 groups.

Each client runs its own CCB deployment and database; the registry below was CCB's internal record of its customers and never touched business data. No `organization_id`, no tenant isolation.

**Done and verified (no schema change):**
- [x] Real health endpoint + System Health page (API process, database, Redis; measured values only) — `GET /system-health`
- [x] Audit-log read API + viewer (search, module/action/date filters, sort, pagination, old/new values with secret masking) — `GET /audit-logs`
- [x] The two broken specs fixed (`jwt.strategy.spec.ts`, `live-role-authorization.spec.ts`) + session-binding tests
- [x] SUPER_ADMIN dashboard from real data (internal users, access, sessions, alerts computed by the API, recent audit, health) — `GET /dashboard/platform`
- [x] Module Catalog screen (rename/reorder, switch on/off) on the existing catalog APIs + server-assembled tree `GET /pmodules/catalog`; core modules protected from deactivation/deletion; empty-name validation gap fixed
- [x] CCB Administration Console redesign (web only, no API change): dedicated SUPER_ADMIN shell; pages live under `/platform/{product,operations,audit,settings}/…` — the Module Catalog sits under Product Management (breadcrumb `Home > Product Management > Module Catalog`), not System Settings, and `/settings/system/*` only redirects; ONE navigation definition (`lib/navigation/admin-console-nav.ts`) drives the sidebar (9 groups; unbuilt items shown disabled as "Planned"), the breadcrumb, tab titles and page headings; Platform Overview dashboard shows real figures only; business layout untouched for every other user
- [x] Verified existing: internal users/roles/policies (last-SUPER_ADMIN protections), platform settings (SUPER_ADMIN-only, audit-logged, no secrets)

**HISTORY — "Built, NOT activated" — REMOVED 2026-11-11 (nothing below this line in this block exists any more; only an archived copy sits outside the repositories):**
- ~~Client registry (profile, contacts, deployment, status lifecycle), licences (record-only; renewals; purchased modules), support requests, time-limited audited support access (two-person approval)~~
- ~~Entities, services, controllers, tests (85) and frontend screens; module NOT imported by `AppModule`; migration in `src/migrations-proposed/`; menu/dashboard entries behind `NEXT_PUBLIC_CLIENT_REGISTRY_ENABLED`~~
- ~~Needs approval: schema design + activation (`docs/CLIENT_REGISTRY_SCHEMA_PROPOSAL.md`, no longer present)~~ — withdrawn: no schema was ever created and none is proposed.
- Still open and unrelated to the vendor modules: permission codes/menu seeds for support staff who are not SUPER_ADMIN; an index on `audit_logs.created_at`.

**Verification:** `tsc --noEmit` clean (API); `nest build` clean; Jest 1,169 tests passing across 58 suites; web `next build` clean, `tsc` no errors in new files (17 pre-existing errors in chart/community files), Vitest 22 passing. No migration was run and no table was created by this work.

**Verification of the console redesign (2026-11-10, no API file touched):** web `tsc` — only the same 17 pre-existing errors; Vitest 65 passing; production `next build` clean (isolated copy); 77 browser end-to-end checks passing against a stubbed API (every menu entry: URL, active item, breadcrumb, heading, tab title; Planned items inert; collapse/expand; keyboard; tablet/mobile drawer; loading/empty/error; dark theme; Arabic RTL; a delegated ADMIN (then called "client ADMIN" — that role no longer exists) keeps the business layout and makes no platform requests); API `tsc --noEmit` clean and the 8 platform Jest suites (226 tests) passing.

---
## Historical record below — REVERTED, not in the codebase

Tracks Phase 2 implementation against the approved architecture (Phase 1 audit → Phase 2 plan → business-workflow extension, all finalized). Updated as work lands. Production migrations/deployment require separate explicit approval — everything here is local/dev only until then.

## Phase A — Organization Foundation (backend) — REVERTED 2026-11-10 (was: done in code)
- [x] A1. `Organization` entity + `OrganizationStatus`/`OrganizationType` enums (`src/modules/organization/entities/organization.entity.ts`)
- [x] A2. `SubscriptionPlan` entity (`.../entities/subscription-plan.entity.ts`)
- [x] A3. `UserInvitation` entity (`.../entities/user-invitation.entity.ts`)
- [x] A4. Migration written: create `organizations` table (`1794500000000-CreateOrganizationsTable.ts`) — **not yet run**
- [x] A5. Migration written: create `subscription_plans` table (`1794400000000-CreateSubscriptionPlansTable.ts`) — **not yet run**
- [x] A6. Migration written: create `user_invitations` table (`1794600000000-CreateUserInvitationsTable.ts`) — **not yet run**
- [x] A7. Migration written: seed one internal/demo `Organization` row, code `INTERNAL-DEMO` (`1794700000000-SeedInternalDemoOrganization.ts`) — **not yet run**
- [x] A8. `OrganizationService`/`SubscriptionPlanService` (CRUD, validated status transitions, subscription assignment) + `OrganizationController` (`@Roles(SUPER_ADMIN)`, `/platform/organizations`) + DTOs
- [x] A9. `OrganizationModule` wired into `AppModule`
- [x] A10. `tsc --noEmit` and `nest build` both clean (4 pre-existing, unrelated spec-file errors confirmed via `git stash`/`pop` round-trip to predate this work — not touched, not introduced by it)

**Deliberately not yet done:** actually running these 4 migrations against any database (dev included) — that's a separate, explicit step, not bundled into code verification. `DB_SYNCHRONIZE=true` is still active in this dev environment per the Phase 1 audit, so simply booting the app would auto-create these tables outside the migration path entirely; this was avoided so the migration sequence itself gets a real, deliberate first run rather than being silently bypassed.

## Phase B — Schema Rollout (backend) — REVERTED 2026-11-10 (was: done in code + migrations written)
- [x] B1. `organization_id` added to all 26 entities, nullable at the TS/entity level where it stays nullable forever (`users`, `roles`, `policies`, `role_policies`, `policy_statements`, `role_inline_policies`, `role_inline_policy_statements`, `user_inline_policies`, `user_inline_policy_statements`, `audit_logs` — NULL = platform-level), non-optional (`number`) everywhere else. Migration `1794800000000-AddOrganizationIdColumns.ts` adds every column NULLABLE at the DB level first regardless (safe, additive). **Deliberate scope note:** `policy_statements`, `role_inline_policy_statements`, `user_inline_policy_statements`, `bill_line_items`, `tariff_tiers`, and `RegistrationRequest`'s 9 cascading child tables were considered for their own direct column too; `tariff_tiers` and the 9 `registration_request_*` children were left to inherit via their one owning parent (never independently listed/searched) — everything explicitly named in the originally-approved entity list got its own column regardless, per "do not silently narrow an approved scope."
- [x] B2. Backfill migration `1794900000000-BackfillOrganizationId.ts` — every plain business table → `INTERNAL-DEMO`; `roles`/`policies` excluded by `role_name = 'SUPER_ADMIN'` / `is_system = 1`; `users` excluded via a `user_roles` join to the SUPER_ADMIN role; everything that inherits from an owning Role/Policy/User (`role_policies`, `policy_statements`, `role_inline_policies` + statements, `user_inline_policies` + statements) copies the owner's own value, including staying `NULL` when the owner is SUPER_ADMIN's own row; `audit_logs` copies the performing user's organization_id as a one-time snapshot. `down()` refuses to run once more than one organization exists (per the documented migration-safety rule).
- [x] B3. FK constraints — `1795000000000-AddOrganizationIdForeignKeys.ts` (`ON DELETE NO ACTION`, unnamed constraints per this project's own synchronize-collision precedent).
- [x] B4. `NOT NULL` flip — `1795100000000-MakeOrganizationIdNotNull.ts`, business tables only, throws if any row is still NULL instead of proceeding.
- [x] B5. Org-scoped unique constraints — `1795200000000-OrganizationScopedUniqueConstraints.ts` (`roles.role_name`, `policies.name` → composite `(organization_id, name)`; introspects and drops the old auto-generated global unique index rather than assuming its name; `down()` refuses if any duplicate name already exists across organizations).
- [x] B6. `tsc --noEmit`, `nest build`, and the **full** existing Jest suite all clean: 960 pre-existing tests still pass, only the same 2 pre-existing spec files fail (4 errors, confirmed unrelated to this work in Phase A). 17 new tests added for `OrganizationService` (status-transition validation, duplicate-code rejection, subscription-assignment audit trail).
- [x] Raw-SQL / QueryBuilder survey for Phase E (requirement: check for cross-org leak risk) — found and logged below; **not fixed yet**, since the isolation-enforcement layer (Phase E) doesn't exist until Phase C's `OrganizationContextService` lands:
  - Raw `dataSource.query` call sites: `billing-cycle.service.ts`, `community.service.ts`, `iam.service.ts`, `property.service.ts`, `role.service.ts`, `tariff.service.ts`
  - `createQueryBuilder` call sites (29 services): includes every tenant-owned-data service plus background/cron-style services worth flagging for requirement #2 (background-job org-awareness) specifically — `sftp-cron.service.ts`, `tariff-scheduler.service.ts`, `workflow-sla-scheduler.service.ts`, `billing-readiness.service.ts`, `ingestion.service.ts`, `estate-summary.service.ts`, `meter-hierarchy-resolver.service.ts`, `sftp-file-list.service.ts`
- [x] Cross-tenant isolation tests — **deliberately deferred to Phase H**, not added now: there is nothing real to verify yet (no query is organization-filtered until Phase E exists), so a test asserting isolation today would only assert that an unwritten feature is absent, not a genuine guarantee. Phase B's own `organization.service.spec.ts` instead covers what Phase B actually introduces (status lifecycle, uniqueness).

**Still not executed:** none of the 4 Phase B migrations have been run against any database — same deliberate hold as Phase A, now with the added, explicit instruction that `DB_SYNCHRONIZE` must be disabled first, with separate approval, before any of this actually runs.

## Phase C — Auth & Organization Context (backend) — REVERTED 2026-11-10 (was: done)
- [x] C1. `nestjs-cls` installed; `ClsModule.forRoot({ global: true, middleware: { mount: true } })` registered in `AppModule` — context exists before any guard runs, not just the ones after some module's own setup.
- [x] C2. `OrganizationContextService` (`src/common/organization-context/organization-context.service.ts`) — thin `ClsService` wrapper, `setOrganizationId`/`getOrganizationId`, `null` = platform-level.
- [x] C3. Live `organizationId` resolution, never trusted from the JWT:
  - `UserAuthState` (`user.service.ts`) and `findAuthState`'s own `select` extended with `organizationId` — same lean, two-query, always-live read `active`/`roles` already use.
  - New `CustomerService.findAuthState` (lean select: `id`, `accountStatus`, `organizationId`) — the Customer's own denormalized column *is* "the appropriate Customer ownership relationship," no extra join needed.
  - `AuthenticatedUser`/`AuthenticatedCustomer` both gained `organizationId?: number | null`.
  - `JwtStrategy.validate` now attaches live `organizationId` on both the staff and customer branches (replaced the customer branch's old heavy `findOne` DTO call with the new lean `findAuthState`). SUPER_ADMIN → `null` (their `User.organizationId` is `null` per Phase B's backfill). Tenant ADMIN/any tenant staff → their live `User.organizationId`. Customer → their live `Customer.organizationId`.
- [x] C4. `OrganizationContextGuard` (always returns `true`, only populates context) + `OrganizationStatusGuard` (blocks SUSPENDED/INACTIVE/PENDING organizations with a `403`, `null` context and `@Public()` routes always pass, new `@AllowSuspendedOrg()` escape hatch mirrors the existing `@AllowPendingPasswordChange()` pattern) — both in `src/common/organization-context/`.
- [x] Guard chain updated and verified in `AuthModule` (requirement: correct execution order): `ThrottlerGuard → JwtAuthGuard → OrganizationContextGuard → CustomerAccessGuard → OrganizationStatusGuard → PasswordChangeGuard → RolesGuard → PermissionGuard`. `OrganizationModule` added to `AuthModule`'s imports (one-directional, no cycle — confirmed `OrganizationModule` imports nothing from `auth/`).
- [x] C5. Tests: 13 new (`organization-context.guard.spec.ts`, `organization-status.guard.spec.ts`) covering SUPER_ADMIN (null context, always passes), Tenant ADMIN / regular tenant staff (real organizationId, blocked when SUSPENDED/INACTIVE/PENDING), Customer principals (own organizationId, blocked the same way when suspended), and `@Public()`/`@AllowSuspendedOrg()` escape hatches. One **pre-existing** test in `user.service.spec.ts` updated (not a new one) to reflect the now-larger `findAuthState` shape — a real, intentional shape change, not a regression.
- [x] `tsc --noEmit`, `nest build`, full Jest suite (973 tests, up from 960) all clean — same 2 pre-existing, unrelated failing spec files as Phases A/B.
- **Known verification gap, stated plainly:** I did not boot the actual NestJS application (`app.listen()`/`TestingModule.compile()` against the real DB) to verify runtime DI wiring end-to-end — this environment hangs for 7+ minutes on a full-module bootstrap against the real dev DB (hit this exact wall earlier in this engagement) and I've deliberately avoided touching the database per your instructions. Verification here is TypeScript-level (every constructor injection type-checks) plus manual module-graph review (`OrganizationModule` exports what `AuthModule` needs, `ClsModule` is global), not a live boot. Flagging this honestly rather than claiming more than was actually checked.

## Phase D — Organization-Scoped IAM (backend) — REVERTED 2026-11-10 (was: done)
- [x] D1 (revised). The hot-path resolver (`IamService.getActionCodesGrantedByPoliciesForRoles`) is **deliberately left untouched** — every write path that could ever create a cross-organization `RolePolicy`/inline-policy row is now blocked at write time (D2 below), so the resolver's own correctness follows by construction rather than needing a redundant, latency-adding re-check on the single most frequently called method in the system. Documented explicitly as a considered tradeoff, not an oversight.
- [x] D2. Full org-scoping across the IAM write/read surface:
  - `RoleService`: `create`/`update`/`remove`/`findOne`/`findOneWithDetails`/`RoleLists`/`getRoleDropdown`/`getRoleFilter`/`getRolePicker` all scoped via a new `applyOrganizationFilter` helper (SUPER_ADMIN's own `null` context correctly sees only its own `organization_id IS NULL` row, never another organization's). `roles.roleName` uniqueness is now per-organization (`SUPER_ADMIN` stays globally reserved at the application layer, unchanged).
  - `IamService`: `createPolicy`/`updatePolicy`/`removePolicy`/`findAllPolicies`/`findOnePolicy`/`getPoliciesForRolePage` scoped the same way; `policies.name` uniqueness is now per-organization. A policy/role belonging to a different organization is reported as **404, never 403** (never confirms it exists to someone who shouldn't know).
  - `attachPolicyToRole`/`detachPolicyFromRole`: both the role and the policy must belong to the caller's own organization, **and** to each other — the one place a cross-organization Role+Policy pairing is explicitly rejected (`ForbiddenException`), closing requirement #3 directly.
  - `RoleInlinePolicyService`/`UserInlinePolicyService`: a newly-created inline policy now mirrors its owning Role's/User's own `organizationId` (no "attach" step exists for these, so write-time mirroring is sufficient — no separate cross-org risk the way shared-Policy attachment has).
  - New `OrganizationContextModule` (`@Global()`) so `OrganizationContextService` is available everywhere without re-declaring it per module.
- [x] D3. **Not built** — this is the actual Organization-onboarding/invitation flow (Phase F), which doesn't exist as code yet. Flagged explicitly rather than stubbed: there is no live code path today that creates a per-organization ADMIN role, so D4's "last-active-ADMIN" protection below is correct and tested, but has no real trigger in the running system until Phase F exists.
- [x] D4. Last-active-ADMIN-per-organization protection: `UserRoleService.lockActiveOrgAdminHolders`/`assertNotLastActiveOrgAdmin` (mirrors the existing SUPER_ADMIN mechanism exactly — same pessimistic-write-lock pattern), wired into `removeRoleFromUser` and into `UserService.update`'s deactivation path and `UserService.remove`'s deletion path (the same two call sites the SUPER_ADMIN version already uses). **Identified by name** (canonicalized match on "ADMIN", scoped to one `organization_id`) — explicitly documented as a deliberate, interim convention pending a real persisted flag once Phase F's bootstrap flow exists, not a permanent design.
- [x] D5 (cross-org prevention, requirement #3 continued). `UserRoleService.addRolesToUser` now refuses to grant a role belonging to a different organization than the target user (SUPER_ADMIN, `organization_id NULL`, is exempt from this specific check — its own grant/revoke privilege rule already covers it separately).
- [x] Confirmed still intact, unchanged: SUPER_ADMIN remains platform-level and fully separate from tenant IAM (requirement #4); Tenant ADMIN still cannot create or assign SUPER_ADMIN (requirement #6 — pre-existing mechanism, re-verified against the new org-scoping rather than rebuilt).
- [x] Tests: 17 new across this phase — organization-scoped Role/Policy CRUD (duplicate-name-per-org, 404-not-403 on cross-org access), `attachPolicyToRole`/`detachPolicyFromRole` cross-organization rejection, `addRolesToUser` cross-organization rejection (+ SUPER_ADMIN exemption), and the full last-active-org-admin suite (refuses on the true last holder, allows when another remains, never applies to an organization-less role). One large pre-existing legacy spec file (`iam.service.spec.ts`/`iam-business-approval.spec.ts`) needed systematic updates to its SUPER_ADMIN-attachment fixtures — under the new model, SUPER_ADMIN's role/policy pairing is only ever reachable from a platform-level (`null`-context) actor, which several existing tests hadn't modeled; fixed by making those specific fixtures platform-level rather than loosening the new check.
- [x] `tsc --noEmit`, `nest build`, and the full Jest suite (**983 tests**, up from 977 after Phase C) all clean — same 2 pre-existing, unrelated failing spec files as every prior phase.

**Still not executed:** no database/migration changes in this phase at all (Phase D was entity/service/guard logic only, built entirely on Phase B's already-written-but-unexecuted schema).

## Phase E — Tenant Isolation Enforcement (backend) — NEVER LANDED IN THE REPOSITORY (paused; nothing to revert)
Running as a 6-domain fix+independent-verify workflow (worktree-isolated): core entities (Community/Property/Unit/Meter/LOV/Attribute), Customer/Registration/Field-Inspection, Billing (Tariff/BillingCycle/BillRun/BillingManagement/BillingReadiness), SFTP reporting + Workflow engine, Global Search (13 providers — confirmed real leak, predates org_id existing), and leftover raw-SQL in Role/IAM. Per-service pattern (no shared base class, matches Phase D precedent), not E1's original "base repository" idea — deliberate deviation, same reasoning as Phase D's D1. E4 (Support Access) and E6 (plan-limit enforcement) confirmed out of scope for E, correctly belong in Phase F below. Final results/numbers land here once the workflow completes.

## New schema gaps found and fixed this phase (not in original Phase B's 26-entity list)
- `FieldInspectionRequest`: real gap, non-nullable FK to Property, no organization_id — added (non-nullable), migration written.
- `Attribute`: finalized decision — custom attributes per-organization (nullable column, like Role/Policy), system-defined stay global.
- `WorkflowDefinition`/`WorkflowDefinitionLevel`/`WorkflowApprovalLevel`: finalized decision — per-organization (non-nullable), instances/steps still inherit transitively, no column on those.
- `RegistrationDocumentRule`, `LovCategory`/`LovValue`: finalized decision — shared platform-wide, no schema change.

## Phase F — Platform Administration + Invitation Flow
- [ ] F1. Platform Administration controller/service: dashboard metrics, Organization CRUD, subscription assignment/renewal, invitations, Support Access start/end
- [ ] F2. Invitation email + public activation endpoint (`User` created `PENDING_ACTIVATION` at invite time; activated on password set; organization resolved from the invitation token only)
- [ ] F3. Frontend: Platform Administration screens (Dashboard, Organization Management, Subscription Management, Tenant ADMIN Management, Platform Settings, Support Access)
- [ ] F4. Frontend: auth store + post-login redirect (SUPER_ADMIN → platform admin, tenant → dashboard, customer → portal)
- [ ] F5. Build + test

## Phase G — Organization-Scoped Settings
- [ ] G1. Move currency/timezone/billing config to per-organization settings; keep genuinely platform-wide settings global
- [ ] G2. Build + test

## Phase H — Multi-Organization Verification
- [x] H1/H2 largely absorbed into Phase E (Org A/B tests landed per-domain instead of as a separate later pass). What's left here: one final full-suite regression run after every Phase E domain merges, before frontend work starts.

## Phase J — Frontend: SUPER_ADMIN Platform Administration (not started, scope only)
Gated behind Phase E (isolation) + ideally F (the APIs below marked "pending") being done. Reuses existing Next.js/Zustand/React Query architecture, AppDataTable, forms, dialogs, filters, nav patterns — no new UI framework.
| Screen | Backend API | Status |
|---|---|---|
| Platform Dashboard (org/subscription metrics) | dashboard metrics endpoint | **Pending** — no endpoint exists yet (Phase F) |
| Organization Management (list/create/view/edit/activate/suspend) | `/platform/organizations` (GET/POST/PATCH/:id/status) | Exists (Phase A) |
| Subscription Plan Management | `/platform/organizations/subscription-plans*` | Exists (Phase A) |
| Subscription assignment/renewal/expiry | `/platform/organizations/:id/subscription` | Exists (Phase A); expiry-warning job not built |
| Tenant ADMIN invitation + management | invitation send/accept endpoints | **Pending** — `UserInvitation` entity exists, no service/controller yet (Phase F) |
| Support Access + visible Support Mode banner | elevation + audit-trail endpoints | **Pending** — not built anywhere yet (Phase F); until then SUPER_ADMIN is simply denied tenant data by default (Phase E), by design |
| Platform Settings | platform-level settings split | **Pending** (Phase G) |
Plus: auth store + post-login redirect (SUPER_ADMIN → platform admin shell), role-based route guards, nav kept fully separate from tenant nav.

## Phase K — Frontend: Tenant ADMIN Organization Application (not started, scope only)
Gated the same as Phase J.
| Screen | Backend API | Status |
|---|---|---|
| Organization dashboard | org-scoped metrics endpoint | **Pending** (Phase F/G) |
| Org-specific user + role management | existing user/role endpoints, now org-scoped by Phase E/D | Exists |
| Existing business modules, scoped to authenticated org | existing endpoints, now org-scoped by Phase E | Exists once E lands |
| Organization settings | org-scoped settings split | **Pending** (Phase G) |
| Read-only subscription info | `/platform/organizations/:id` (read-only projection) | Exists (Phase A), needs a read-only tenant-facing route |
Hard rule carried into every screen above: organization context is always resolved server-side from the authenticated profile (Phase C) — the frontend never sends or trusts an org id of its own. Customer portal: no changes planned, preserved as-is.

## Phase I — Hardening
- [ ] I1. `DB_SYNCHRONIZE` review/disable recommendation
- [ ] I2. Full regression pass, staging rollout rehearsal

---
**Former decisions — SUPERSEDED by the 2026-11-10 pause, no longer in force:** Organization (not Tenant) naming; shared IAM catalog with org-scoped Roles/Policies (Option B); internal/demo org absorbs existing data, SUPER_ADMIN stays `organization_id = NULL`; isolation is a hard row-level filter independent of Policy; `User` created at invite time as `PENDING_ACTIVATION`; subscription expiry only warns, never auto-suspends; `INACTIVE → ACTIVE` reactivation allowed; subscription plan limits are hard-enforced and configurable per plan.
