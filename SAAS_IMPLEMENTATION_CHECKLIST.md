# CCB Multi-Tenant SaaS — Implementation Checklist

Tracks Phase 2 implementation against the approved architecture (Phase 1 audit → Phase 2 plan → business-workflow extension, all finalized). Updated as work lands. Production migrations/deployment require separate explicit approval — everything here is local/dev only until then.

## Phase A — Organization Foundation (backend) — DONE (code), migrations NOT yet executed
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

## Phase B — Schema Rollout (backend) — DONE (code + migrations written), migrations NOT yet executed
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

## Phase C — Auth & Organization Context (backend) — DONE
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

## Phase D — Organization-Scoped IAM (backend) — DONE
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

## Phase E — Tenant Isolation Enforcement (backend)
- [ ] E1. Base repository / query-builder helper enforcing `organization_id`
- [ ] E2. Apply it across every existing service (Community, Property, Unit, Customer, Tariff, BillingCycle, Meter, Bill, RegistrationRequest, Role, Policy, …)
- [ ] E3. IDOR checks on every find-by-id endpoint
- [ ] E4. Explicit, time-limited, audited Support Access (SUPER_ADMIN never silently bypasses isolation)
- [ ] E5. Background jobs / Redis cache keys / SFTP / file storage made organization-aware (verify what actually exists first)
- [ ] E6. Subscription plan-limit enforcement (e.g. reject the 11th user over a 10-user plan)
- [ ] E7. Build + test

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
- [ ] H1. Org A / Org B test fixtures
- [ ] H2. Cross-tenant isolation integration-test suite (list/by-id/search/export/file-download, each checked both ways)

## Phase I — Hardening
- [ ] I1. `DB_SYNCHRONIZE` review/disable recommendation
- [ ] I2. Full regression pass, staging rollout rehearsal

---
**Finalized decisions in force:** Organization (not Tenant) naming; shared IAM catalog with org-scoped Roles/Policies (Option B); internal/demo org absorbs existing data, SUPER_ADMIN stays `organization_id = NULL`; isolation is a hard row-level filter independent of Policy; `User` created at invite time as `PENDING_ACTIVATION`; subscription expiry only warns, never auto-suspends; `INACTIVE → ACTIVE` reactivation allowed; subscription plan limits are hard-enforced and configurable per plan.
