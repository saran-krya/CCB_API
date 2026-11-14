# CCB Platform — Audit Remediation Tracker

Persistent, resumable record of the complete audit remediation project (Phases 1–7). Read this file first in any
new session before touching a finding — it says exactly what is done, what is partial, and what is next.

**IMPORTANT — source-of-truth gap.** No original audit report document (the one enumerating every finding C1–L14
and X1–X8 with its own description) exists in this repository or `CCB_WEB`/`CCB_template`, and none has been
pasted into this project in full — only phase-grouped bullet summaries, with explicit IDs for some findings
(C1, H1, H3, H4, M1, M5, M6, M7, M10, X1, X2) and none for the rest (every Phase 3–6 bullet, and the entire L1–L14
range). This tracker records real findings by the description actually given, and uses the real ID where one was
given. It does **not** invent IDs or descriptions for L1–L14 or any other unlabeled finding — if the original
report exists outside this conversation, provide it so those rows can be filled in accurately instead of guessed.

**How to resume:** read the status table below, open the "Next action" line, continue from there. Do not re-open a
row marked Fixed without a reason (regression, new information). Do not assume a file described here still matches
reality in a later session — re-read it; this file is a log of what was done and verified, not a live mirror of
the code.

---

## Status table

| ID | Finding | Phase | Status | Session |
|---|---|---|---|---|
| C1 | Production startup/build path issues | 1 | Fixed (prior session) | — |
| H1 | SUPER_ADMIN account lockout vulnerability | 1 | Fixed (prior session) | — |
| H4 | Node.js runtime compatibility | 1 | Fixed (prior session) | — |
| M5 | Health/liveness/readiness endpoints | 1 | Fixed (prior session) | — |
| M6 | Graceful application shutdown | 1 | Fixed (prior session) | — |
| M7 | Reverse-proxy IP detection / TRUST_PROXY | 1 | Fixed (prior session) | — |
| H3 | Audit logs security hardening | 2 | **Fixed** | 2026-11-13 (commit `23b1b3f`) |
| M1 | Module Catalog backend protection and immutability | 2 | **Fixed** | 2026-11-14 |
| M10 | SUPER_ADMIN password reset security | 2 | **Fixed** | 2026-11-14 |
| — | Missing security audit events | 2 | **Fixed** | 2026-11-14 |
| — | Authentication timing / invitation token security | 2 | **Fixed** | 2026-11-14 |
| — | Authorization consistency across modules | 2 | **Reviewed — no gap found** | 2026-11-14 |
| X1 | MFA/2FA, especially for SUPER_ADMIN | 2 | Not started | — |
| X2 | Secure password recovery | 2 | Not started | — |
| — | Database permissions / sensitive configuration review | 2 | Not started | — |
| — | Phase 3 — i18n/RTL (all bullets) | 3 | Not started | — |
| — | Phase 4 — audit/DB/performance (all bullets) | 4 | Not started | — |
| — | Phase 5 — platform settings/missing features (all bullets) | 5 | Not started | — |
| — | Phase 6 — infrastructure/operations (all bullets) | 6 | Not started | — |
| L1–L14 | Unknown — no original report text available | 6 | **Cannot be enumerated without the source report** | — |
| — | Phase 7 — final verification | 7 | Not started | — |

**Next action:** X1 (MFA/2FA for SUPER_ADMIN) and X2 (secure password recovery) — the two large remaining Phase 2 items.

---

## H3 — Audit logs security hardening (Fixed, commit `23b1b3f`)

See `docs/OPERATIONS.md` §7 for the operational writeup. Summary for this tracker:

- **Root cause:** `audit_logs` had no database-level enforcement against UPDATE/DELETE (no trigger existed), and
  the documented `SECURITY_EVENT.ACCESS_DENIED` event was never actually written by anything.
- **Implementation:** `src/migrations/1795700000000-AddAuditLogsAppendOnlyTrigger.ts` (BEFORE UPDATE/DELETE
  triggers); `scripts/db/provision-db-users.sql` (TRIGGER privilege to the migration account only); `scripts/ops/preflight.ts`
  (verifies both triggers exist); `src/common/security/access-denied-audit.ts` + `.spec.ts` (writes `ACCESS_DENIED`
  for a signed-in staff 403, wired into `src/main.ts`); `src/audit/audit.module.ts` (provider registration).
- **Verification:** `npx jest src/audit src/common/security` — 3 suites / 47 tests pass. `tsc --noEmit` clean.
  **Database-level (the trigger actually blocking a real UPDATE/DELETE) is NOT verified** — no migration has been
  run against any database this project. Operator action required before this is live: run
  `npm run migration:run` with the migration account, re-apply the updated GRANT to any already-provisioned
  `ccb_migrator`, then `npm run preflight` should show "Audit log immutability: PASS".

---

## M1 — Module Catalog backend protection and immutability (Fixed, 2026-11-14)

- **Root cause:** protection against deactivating/renaming/deleting a module the platform needs
  (`PROTECTED_MODULE_CODES` = DASHBOARD, SYSTEM_ADMIN, PERSONAL_SETTINGS, SECURITY_SETTINGS) existed ONLY on
  the `PModule` row itself (`PModulesService.update`/`remove`). `SubModulesService` and `ScreensService` had
  **no** such check at all — any sub-module or screen could be deactivated, re-coded, moved to a different
  module, or deleted unconditionally, including ones a protected module's menu entry actually depends on (e.g.
  `SETTINGS_PASSWORD` under `SECURITY_SETTINGS`, every sub-module under `SYSTEM_ADMIN`). Deleting all of a
  protected module's children has the same practical effect as deleting the module: an empty, useless menu
  entry. Separately, neither service checked for orphaned children before a soft-delete (a sub-module with
  screens still under it, a screen with actions still defined on it) — a real data-integrity gap, not just a
  protection one. `ActionsService` already had its own, more precise protection (`SYSTEM_ACTION_CODES`:
  every seeded action code + every IAM resource-catalog code) but did not block **re-parenting** a system
  action to a different screen.
- **Design decision:** rather than maintain a second, hand-curated whitelist of "protected sub-module/screen
  codes" (fragile, drifts from the seed data), a sub-module/screen is protected when its CURRENT parent
  resolves (directly, or one level through its sub-module) to a `PROTECTED_MODULE_CODES` entry — single
  source of truth, same architecture pattern the module level already used. This is intentionally coarse: it
  protects every sub-module/screen under those 4 modules, not just the ones literally required for sign-in and
  self-service. Documented as a deliberate, conservative choice.
- **Implementation:**
  - `src/modules/pmodules/pmodules.constants.ts` — added `isProtectedModuleCode()` helper (single source of
    truth, used everywhere below instead of ad-hoc `.includes()`).
  - `src/modules/sub-modules/sub-modules.service.ts` — `update()` now blocks deactivate/code-change/re-parent
    of a sub-module whose current module is protected; `remove()` blocks deleting a protected sub-module AND
    blocks deleting one that still has screens.
  - `src/modules/screens/screens.service.ts` — same four checks for a screen, resolving its owning module
    either directly (`pModuleId`) or through its sub-module (`subModuleId` → `subModule.pModule`); `remove()`
    also blocks deleting a screen that still has actions. Needed the `Action` entity registered in
    `screens.module.ts` (`TypeOrmModule.forFeature`) to run that check.
  - `src/modules/actions/actions.service.ts` — `update()` now also rejects re-parenting (`screenId` change)
    for a system action, alongside the existing rename/deactivate block.
  - `src/common/constants/error-messages.constants.ts` — new messages:
    `SUB_MODULE_PROTECTED_CANNOT_DEACTIVATE/DELETE/CODE_LOCKED/CANNOT_REPARENT`,
    `SCREEN_PROTECTED_CANNOT_DEACTIVATE/DELETE/CODE_LOCKED/CANNOT_REPARENT`, `SUB_MODULE_HAS_CHILDREN`,
    `SCREEN_HAS_CHILDREN`.
  - `src/modules/pmodules/dto/module-catalog.dto.ts` + `pmodules.service.ts` (`getCatalog()`) — added
    `isProtected` to `CatalogSubModule`/`CatalogScreen` (previously module-level only), so the console can show
    *why* a toggle is disabled instead of the administrator only finding out from a 403 toast.
  - RBAC: confirmed (no change needed) — `PModulesController`/`SubModulesController`/`ScreensController`/
    `ActionsController` are already consistently `@Roles(SUPER_ADMIN)` at the class level.
- **Migrations:** none — no schema change, only service-layer logic and a DTO field.
- **Tests:** new `src/modules/sub-modules/sub-modules.service.spec.ts` (9 tests) and
  `src/modules/screens/screens.service.spec.ts` (13 tests) — did not exist before this finding. Updated
  `src/modules/pmodules/pmodules.service.spec.ts` (+2 tests, 1 existing assertion extended for the new
  `isProtected` field) and `src/modules/actions/actions.service.spec.ts` (reparent case added, one message
  string updated). `npx jest src/modules/pmodules src/modules/sub-modules src/modules/screens src/modules/actions`
  → **4 suites / 61 tests, all pass.** `tsc --noEmit` → clean.
- **Remaining:** none identified. Frontend (`CCB_WEB`) Module Catalog UI was not touched — out of scope for a
  backend finding; it already surfaces a 403 as an error toast generically, and now also receives
  `isProtected` on sub-modules/screens if a future UI pass wants to grey out the control pre-emptively instead
  of only after a rejected request.

## M10 — SUPER_ADMIN password reset security (Fixed, 2026-11-14)

- **Root cause:** `docs/ON_PREMISE_SUPER_ADMIN.md` §11 item 6 already documented this as an OPEN, unresolved
  decision: *"Today another SUPER_ADMIN can still reset the initial administrator's password or change its
  e-mail (it is 'looking after' the account, not losing it). Should those also need the server tool?"*
  Verified in code: `AuthService.adminResetPassword` calls `assertActorMayModifyUser` and
  `assertActorMayTakeOverAccount`, both of which return immediately (no lookup) for any SUPER_ADMIN actor —
  `assertNotInitialAdministrator` (the check `disableSigninAccess` already uses) was never called. Separately,
  `UserService.update` lets `dto.email` change with the same unconditional SUPER_ADMIN exemption and no
  initial-administrator check at all. Net effect: any one of several co-equal SUPER_ADMINs could silently
  reset the installation's OWNER account's password (a fully working login) or redirect its e-mail, with no
  confirmation and no notification to the real owner — a single compromised SUPER_ADMIN credential was enough
  to take over the one account every other protection (deletion/deactivation/demotion/sign-in-disable) was
  built to keep safe.
- **Decision:** resolved the open question as "yes, guard it" for password reset and e-mail change
  specifically (both are a path to the owner's identity), while explicitly leaving ordinary profile edits
  (name, mobile, designation) and ordinary peer-to-peer SUPER_ADMIN resets (any account OTHER than the
  initial one) unchanged — consistent with this codebase's existing "SUPER_ADMINs trust each other" model,
  which this finding does not try to overturn wholesale.
- **Implementation:**
  - `src/auth/auth.service.ts` (`adminResetPassword`) — added `assertNotInitialAdministrator(targetUserId,
    'reset the password of')` right after the existing SUPER_ADMIN-account check, before the assignment
    boundary.
  - `src/modules/user/user.service.ts` (`update`) — added the same check, scoped to only fire when
    `dto.email` is actually changing (`'change the e-mail address of'`).
  - `src/modules/user-role/user-role.service.ts` — updated `assertNotInitialAdministrator`'s own doc comment
    (it previously said the opposite: "deliberately NOT a rule against ... resetting its password").
  - `docs/ON_PREMISE_SUPER_ADMIN.md` §4.1 and §11 item 6, `docs/SECURITY_HARDENING.md` (initial-SUPER_ADMIN
    table row) — updated to describe the new guarantee and mark the open question resolved.
- **Migrations:** none — pure authorization-logic change, no schema impact.
- **Tests:** `src/auth/admin-credential-actions.spec.ts` — new test for the 403 + call-ordering, updated the
  "goes through the same questions" test. `src/modules/user/user.service.spec.ts` — 3 new tests (initial
  administrator's e-mail blocked / a non-initial SUPER_ADMIN's e-mail still changeable / re-saving the SAME
  e-mail is not treated as a change). `npx jest src/modules/user src/auth src/modules/user-role` → **12
  suites / 391 tests, all pass.** `tsc --noEmit` → clean.
- **Remaining:** none identified for the specific gap this finding named. Noted, not actioned (out of scope
  for M10, belongs to X1/X2): there is still no step-up/MFA challenge before ANY admin-reset of ANY account,
  and no notification e-mail to the account holder when their password is reset or e-mail changed by someone
  else — both become directly actionable once X1 (MFA) and SMTP/email-template delivery are in place.

## Missing security audit events (Fixed, 2026-11-14)

- **Investigation:** audited every `SECURITY_EVENT.*` constant (`src/audit/audit.constants.ts`) against actual
  call sites. Found: `LOGIN_FAILED`, `ACCOUNT_LOCKED`, `ACCOUNT_PROTECTED`, `IP_LOCKED`, `SIGNIN_UNLOCKED`,
  `REFRESH_REPLAY_DETECTED` were all already wired up and well-tested; `ACCESS_DENIED` was wired up by H3 this
  session; every `MFA_*`, `PASSWORD_RECOVERY_*`, `AUDIT_EXPORTED` and `AUDIT_INTEGRITY_FAILED` constant is
  unused vocabulary for a feature that does not exist yet (X1, X2, Phase 4 audit export/integrity respectively)
  — adding a call to one now, with no feature behind it, would be dead code, not a fix. Every admin credential
  action (`ADMIN_RESET_PASSWORD`, `DISABLE_SIGNIN_ACCESS`, `REVOKE_SESSIONS`, `UNLOCK_SIGNIN`) and every
  session-ending path (`logout`, `logoutDevice`, `logoutEverywhere`, `logoutOtherSessions`) already audits
  itself. The one genuine, currently-reachable gap: `AuthService.login()`'s "authenticated identity, refused
  standing" branches (a CORRECT password for a deactivated staff account or an overdue customer account) logged
  a warning only — no audit/security trail at all, and no existing test exercised either branch.
- **Implementation:** new `SECURITY_EVENT.SIGNIN_BLOCKED_ACCOUNT_STATUS` (`audit.constants.ts`); both `login()`
  branches now call a new `noteSigninBlockedByStatus` helper (`src/auth/auth.service.ts`) — deliberately NOT
  routed through the lock-out counters (`noteFailedSignIn`), since this proves a real password and must never
  tighten the account's own guess-lockout.
- **Migrations:** none.
- **Tests:** new `src/auth/login-account-status.spec.ts` (3 tests — no prior spec exercised `login()`'s
  inactive/overdue branches at all): deactivated staff blocked + audited, overdue customer blocked + audited,
  and a wrong password against an inactive account still only ever produces ordinary `LOGIN_FAILED` (status is
  never leaked before the password is confirmed). `npx jest src/auth` → **7 suites / 113 tests, all pass.**
  `tsc --noEmit` → clean.
- **Docs:** `docs/SECURITY_HARDENING.md` §3 updated to list the new event.
- **Remaining:** none for the currently-built surface. The full success path of `login()` (issuing tokens) still
  has no dedicated unit test of its own (pre-existing gap, not introduced here) — noted for Phase 7 final
  verification, not fixed in this pass to keep this change scoped to the audit-event gap it was asked to close.

## Authentication timing / invitation token security (Fixed, 2026-11-14)

- **Investigation — invitation tokens:** reviewed `account-invitation.service.ts` and `common/utils/secure-token.util.ts`
  in full. Found no gap: 32 random bytes (`crypto.randomBytes`, 256 bits) hashed with SHA-256 before storage
  (the raw token exists only in the e-mailed link, never logged/audited); single-use enforced by one atomic
  conditional `UPDATE ... WHERE status='PENDING' AND expires_at > NOW(6)` (of two simultaneous accept attempts
  exactly one wins); 24-hour expiry judged by the DATABASE clock, not the app server's; a re-send invalidates
  the previous token; the public `validate`/`accept` endpoints return the identical `INVALID_LINK` message for
  every failure reason (no such token, expired, already used, account no longer eligible) and `validate` masks
  the e-mail address even for a genuinely valid token. This was already correctly built (recent work, the same
  migration that created the table) — nothing changed here.
- **Root cause — authentication timing:** `AuthService.login()`'s own password checks were
  `!!x.passwordHash && (await bcrypt.compare(...))` — bcrypt.compare (by far the slowest step, ~100-300ms at
  this project's cost factor) was SKIPPED entirely whenever there was no real hash to compare against: a
  non-existent e-mail, or an existing account whose sign-in is disabled (`passwordHash: null`). Both then
  answered measurably FASTER than an existing, active account with a wrong password — even though every path
  returns the identical "Invalid credentials" message, defeating the point of that identical message via a
  timing side channel instead.
- **Implementation:** `src/auth/auth.service.ts` — added a lazily-computed, memoized `dummyPasswordHash()` (a
  real bcrypt hash of a password nobody uses, computed once); both branches of `login()` now always call
  `bcrypt.compare`, falling back to the dummy hash instead of skipping the comparison. No behavior or message
  changes — only the internal timing path.
- **Migrations:** none.
- **Tests:** new `src/auth/login-timing-safety.spec.ts` (3 tests: non-existent e-mail, disabled staff account,
  customer with no password set — all three now provably invoke `bcrypt.compare` rather than skipping it).
  `npx jest src/auth` → **8 suites / 116 tests, all pass.** `tsc --noEmit` → clean.
- **Docs:** `docs/SECURITY_HARDENING.md` §3 updated (brute-force bullet).
- **Remaining:** none identified.

## Authorization consistency across all modules (Reviewed — no gap found, 2026-11-14)

A full line-by-line audit of all 39 controllers was not attempted (unbounded scope for one bullet in a
7-phase project); this was a targeted review of the highest-risk patterns, honestly reported as such rather
than claimed as exhaustive:
- **No controller lacks an authorization decorator entirely** — every one of the 39 controller files in
  `src/modules`/`src/auth`/`src/audit` uses at least one of `@Roles`/`@Permission`/`@Authenticated`/`@Public`.
  Combined with `PermissionGuard`/`RolesGuard` failing CLOSED by default (confirmed by the guards' own specs,
  which use a deliberately-unguarded `ProbeController` fixture to prove a route with no rule is denied, not
  allowed) — an accidentally-unguarded route in this codebase is a functionality bug (always 403), never an
  open-access one.
- **Every `@Public()` use was read in context** (7 total, sitewide): login, refresh, logout, SSO redirect
  (`auth.controller.ts`), invitation validate/accept (already reviewed above), customer account activation
  (`customer.controller.ts`, rate-limited). All are routes that must work for an unauthenticated caller by
  design, and none return more than that design requires.
- **Customer-portal IDOR surface reviewed in full** (`customer-portal.service.ts`/`.controller.ts`) — the
  highest-risk surface for a cross-tenant access bug, since it's the one principal type (Customer) whose every
  record must be scoped to "my own account only". Every `getMy<X>(id)` method resolves ownership
  server-side (`getOwnedUnitIds` / an explicit `assertOwnsUnit`/membership check) before returning anything,
  and `customerId` is sourced ONLY from `@CurrentCustomer()` (the JWT principal), never from a client-supplied
  parameter — confirmed by the file's own `/me/*` naming convention and doc comment stating this explicitly.
- **Already-documented, deliberate exceptions** (`docs/SECURITY_HARDENING.md` §6, pre-existing): a short list
  of permission codes that are UI-gating only — a decision already made and written down, not an oversight.
- **Not reviewed in this pass** (recommend a dedicated follow-up if exhaustive, module-by-module coverage is
  wanted): the remaining ~35 controllers' individual route-to-permission-code mappings were not each checked
  by hand for "is this the RIGHT code for this operation's actual risk" — only the structural patterns above.
