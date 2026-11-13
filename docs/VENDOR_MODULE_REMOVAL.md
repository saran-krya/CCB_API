# Vendor modules removed from the customer application

> **Status (2026-11-11): done in code, never compiled, run or tested** — under the "no tests, no builds, no servers, no SQL" order. Every claim below was checked by **reading** the code and by static scripts (every import and export resolved, no unresolved name, no duplicate declaration); none of it has been executed. Test it before you rely on it.

CCB is **on-premises** software: each customer runs its own installation and database, and its `SUPER_ADMIN` is the customer's own highest administrator ([ON_PREMISE_SUPER_ADMIN.md](ON_PREMISE_SUPER_ADMIN.md)). Everything that existed only for **CCB-the-vendor** to track, deploy, license or support customers was therefore **removed from the customer application** — deleted from the code, not hidden behind an environment flag.

## 1. Where the removed code is

None of the removed files was ever committed to git (the vendor work and the whole administration console were still uncommitted), so deleting them from the working tree would have been irreversible. They were **copied first** to:

```
D:\saran\CCB parent\_removed-vendor-modules-2026-11-11\        (README.md lists every item; paths are mirrored: "CCB API/…", "CCB_Web/…")
```

That folder sits **outside both repositories**, is not part of any release, and is the **only copy**. Delete the folder when you no longer want the code.

**What the archive can and cannot restore.** It holds only the **whole files and folders that were deleted** — copy one back to its mirrored path and it is there again. It does **not** hold the *edits to files that stayed*: the `start:platform` script in `package.json`, the registry keys of `console.json`, the navigation entries and the `requiresRegistry` mechanism, the `NEXT_PUBLIC_…` flags, the deployment-role constants and the three business-code prefixes. A restored vendor module therefore would not compile, appear in the menu or find its texts until those edits are redone by hand.

**Stale compiled output.** The API's `dist/` folder (git-ignored) was **not** touched and still holds compiled copies of the removed modules (`dist/src/modules/client-registry`, `dist/src/modules/user-invitation`, `dist/src/platform`, `dist/src/config/platform-data-source.*`, `dist/src/mail/templates/staff-invitation.template.*` and `dist/src/migrations-proposed`). They are inert — `AppModule` no longer references them and the migration glob does not match `migrations-proposed` — but `dist/src/platform` could still be launched by hand. **Delete `dist/` (or build into a clean directory) before deploying**; this project has no `deleteOutDir`, so a normal build keeps them.

## 2. What was removed

### API (`CCB API`)

| Removed | What it was |
|---|---|
| `src/modules/client-registry/` | client registry (clients, contacts, status lifecycle), deployments, licences, renewals, purchased modules, support requests, time-limited support access, provisioning jobs / steps, secret store, deployment manifests — never imported by `AppModule` |
| `src/platform/`, `src/config/platform-data-source.ts`, `scripts/start-platform.cjs`, `.env.platform.example`, the `start:platform` script in `package.json` | the **separate platform application entry point** (its own bootstrap, role guard, data source, launcher and environment template) |
| `src/modules/user-invitation/`, `src/mail/templates/staff-invitation.template.ts` | the first-administrator **invitation workflow** (a platform created the first administrator inside a client's database). Inert: it needed a `user_invitations` table that this module never created (the local development database may hold an unrelated leftover of that name from the paused SaaS work — §4), and was not imported by `AppModule` |
| `src/migrations-proposed/` (3 drafts: registry, provisioning, invitations) | schema drafts that sat outside the migration glob — **nothing ever ran them** |
| `docs/CLIENT_PROVISIONING_DESIGN.md`, `CLIENT_REGISTRY_SCHEMA_PROPOSAL.md`, `DEPLOYMENT_ROLE.md`, `PLATFORM_CONSOLE.md`, `REGISTRY_ACTIVATION.md`, `SUPER_ADMIN_READINESS.md`, `docs/provisioning/` | design documents of the vendor-hosted model |
| Deployment-role scaffolding: `CLIENT_ADMIN`, `CCB_DEPLOYMENT_ROLE`, the deployment-context resolver, its environment validation, three business-code prefixes (`CLT`, `LIC`, `SUP`) | only ever used by the removed code |

### Web (`CCB_Web`)

| Removed | What it was |
|---|---|
| `app/(protected)/platform/{clients,deployments,licenses,support,operations/deployments}` | Client Registry, Register Client, client detail / edit / lifecycle, Deployment Management / Status, Licensing & Renewals, Support Operations / History |
| `app/accept-invitation` | public page of the invitation workflow |
| `components/platform/`, the Overview panels `ClientOperationsPanel`, `LicenseRenewalPanel`, `SupportOperationsPanel`, `BusinessMetrics`, `RegistryNotEnabledNotice`, `QuickActionsPanel` | their UI |
| `api/client-registry.api.ts`, `api/user-invitation.api.ts`, `hooks/queries/clientRegistry.ts`, `hooks/mutations/clientRegistry.ts`, `hooks/useRegistryText.ts`, `interfaces/client-registry.interface.ts` | their frontend API integration |
| `lib/constants/client-registry.constants.ts`, `lib/constants/platform-registry.ts`, `lib/utils/{client-next-step, client-registry.validation, client-status-action, deployment-actions, deployment-status, initial-admin-invitation, registry-availability, registry-tone, support-history}.util.ts` and their tests | their rules |
| `i18n/resources/ar/registry.json` (the registry dictionary) and the registry keys of `console.json` | their texts |
| `components/common/RadioCardGroup.tsx` | a shared component that nothing else used once the removed screens were gone |
| The `NEXT_PUBLIC_CLIENT_REGISTRY_ENABLED` / deployment-mode flags and the `requiresRegistry` navigation mechanism | there is nothing left to switch |

The console navigation is now **6 groups** (Overview, Product Management, Internal Administration, System Operations, Audit & Compliance, Platform Settings) with **no disabled, "Planned" or flag-gated entry**.

## 3. What was kept — shared dependencies inspected before deleting

Before anything was deleted, the code that referenced the vendor modules was inspected; these shared pieces are **needed by the customer administration** and were kept (some adapted):

| Kept | Why |
|---|---|
| `AuditModule`, `AuditService`, audit-log API and viewer | audit logging is a customer feature used by every module; **not touched** by the removal |
| User, Role, Policy, IAM, user-role modules | the customer's user / role / permission management |
| Attribute and Lookup-value (LOV) modules | system attributes and lookup values |
| Settings module | application settings |
| System-health module, application information | the customer's own operations view |
| Module catalog (`pmodules`, sub-modules, screens, actions) | the installation's own menu structure |
| `MailService` | customer activation and notifications. Its comment no longer names the removed invitation |
| Dashboard platform service and alerts (`platform-dashboard.service.ts`, `platform-alerts.ts`) | the Overview's alerts and counts. The API computes database-down, cache-down and four user-administration conditions (no active `SUPER_ADMIN`, a single one, a pending first password, never signed in); the web shows only the two operational ones and leaves the user-administration ones to the Users screen — unchanged by the removal |
| Console shell and primitives: `AdminConsoleShell`, `ConsolePage`, `ConsolePanel`, `ConsoleSidebar`, `ConsoleTopBar`, `ConsoleBanner`, `ConsoleBadge`, `ConsoleStatusBadge`, `ConsoleNotifications`, … | the approved UI — **visually unchanged** |
| Overview: `PlatformOverview`, `OperationalAlerts`, `HealthSummaryPanel`, `PlatformActivityPanel` | adapted to show alerts, health and administrative activity only |
| `ErrorRetry`, `LoadingState`, `WizardFooter`, `PageRegion` | shared components of the business application too |
| `MetricStrip` | generic console primitive; currently **unused**, kept deliberately |
| `lib/navigation/admin-console-nav.ts`, route metadata, breadcrumb, document-title utilities | one navigation definition drives sidebar, breadcrumb, tab titles |
| npm dependencies | **none removed** — no package was vendor-only |

## 4. Impact — what to check

* **Nothing outside the removed folders referenced them**: a static scan of all 500 API and 663 web source files found no unresolved import, no name used without an import, and no duplicate declaration. It is not a compile: run `tsc` and the test suites yourself.
* **Endpoints that no longer exist:** `/client-registry/*`, `/user-invitations/*` and the `/accept-invitation` page. The API module was never imported by `AppModule`, so those web screens had no live backend; any external tooling of your own that called these endpoints is gone with them.
* **Database:** the removed modules created **no table** — their migrations were never run. The application loads only the entities of the modules it imports (`autoLoadEntities`), so the vendor entities were never synchronised either. A *development* database may still hold leftovers from the earlier, paused SaaS experiment (`organizations`, `subscription_plans`, `user_invitations`) — see the banner in [SAAS_IMPLEMENTATION_CHECKLIST.md](../SAAS_IMPLEMENTATION_CHECKLIST.md) and [PROPOSED_SCHEMA_CHANGES.md](PROPOSED_SCHEMA_CHANGES.md) §1.
* **Environment files:** the deployment-role and platform variables are no longer read. An old `.env` that still sets them is harmless; `.env.platform.example` is gone.
* **Orphans I left alone on purpose:** `MetricStrip` (above). Nothing else in the removed set is still referenced.
* **A decision for you:** the client-side `user-invitation` module was removed together with the vendor workflow it served. If you want e-mail invitations for new administrators (secure password setup by link), that feature needs the `user_invitations` table — proposed, **not created** ([PROPOSED_SCHEMA_CHANGES.md](PROPOSED_SCHEMA_CHANGES.md) §1). The code can be restored from the archive.

## 4a. Future work that is deliberately not here

* A read-only **"this installation's licence"** view and licence enforcement — needs a licensing design and schema.
* A **"contact CCB support"** entry on the customer side.
* **Product versions** in the module catalog.
