# CCB API

NestJS backend for the CCB billing platform.

**CCB is on-premises software:** every customer runs its own installation with its own database, and the installation's highest
administrator is the customer's own `SUPER_ADMIN` — never a CCB account. The model, the first-time installation, creating further
administrators, recovery, upgrades and which console modules are kept, adapted or left out of a customer release are in
[docs/ON_PREMISE_SUPER_ADMIN.md](docs/ON_PREMISE_SUPER_ADMIN.md). The sections below describe the bootstrap in detail.

## Default Super Admin & Initial Permissions

This section documents exactly what happens the first time the application connects to a
database, and what happens on every run after that. It describes the real behavior in
`src/bootstrap/bootstrap.service.ts` and `src/modules/role-permissions/role-permissions.service.ts`
— nothing here is approximate.

### Schema creation (migrations) — before any seeding

The schema is created by migrations, never by `synchronize` outside local development (`synchronize` is a startup
error anywhere but `NODE_ENV=development`). TypeORM applies every pending migration at startup, in timestamp order
(`DB_MIGRATIONS_RUN=false` turns that off — then run `npm run migration:run` yourself, with
`DB_MIGRATION_USERNAME` / `DB_MIGRATION_PASSWORD` if DDL needs a separate account).

- **Empty database:** the older migrations are deltas written against a schema that `synchronize` had already
  created, so on an empty database each one detects the missing tables and skips itself. The last one,
  `src/migrations/1793800000001-InitialSchemaBaseline.ts`, then builds the complete schema — every table, index,
  unique key and foreign key, generated from the entities with TypeORM's own schema builder. It deliberately sits
  AFTER the deltas: at least one of them (`RehomeBillRunScreenToBillingManagement`) queries a table name that no
  longer exists in the finished schema.
- **Existing database:** the baseline does nothing as soon as any application table holds a row — it never drops,
  alters or rewrites anything — so only the genuinely pending migrations are applied and every row is kept. On a
  database with no data it only adds what is missing, so a run interrupted half-way is completed by the next one.
- The baseline is a frozen snapshot: never edit it to change the schema — add a new migration.
- If the API starts against a database with no schema (for example `DB_MIGRATIONS_RUN=false` and no manual run), it
  stops with an error saying so instead of failing on a missing table.

### Fresh database (first ever boot)

Once the schema exists, `BootstrapService.onApplicationBootstrap()` checks whether the `users` table has any
row at all — soft-deleted and deactivated accounts count too. If it is empty, this is treated as a brand-new install and the
following happens, inside one database transaction:

1. Every module, sub-module, screen, and action (the full permission tree) is seeded from
   `src/bootstrap/seed-data.ts`; then the list-of-values (LOV) entries and the system attributes.
2. The one predefined role, `SUPER_ADMIN`, is created. It is the ONLY role the system defines: every other role is
   created and managed dynamically by `SUPER_ADMIN` through the application (Roles & Permissions) and lives only in
   the database — nothing is seeded, assumed, reserved or auto-granted for any other role name.
3. **The installation's ONE default administrator account is created and assigned the `SUPER_ADMIN` role** (skipped with
   `BOOTSTRAP_SEED_ADMIN=false`, in which case the first administrator is created afterwards with
   `npm run maintenance:super-admin`). Its password is only a temporary one from the installer's environment: the account is
   created with "must change password at first sign-in", so its holder chooses their own.
4. **Only when sample data is enabled** (see below): the Community / Property / Unit master data (8 communities, 67
   properties, 111 units) from `src/bootstrap/seed-locations.ts`, which carries the data of
   `seed-community-property-unit.sql`. It is ONE estate's data, so it is **never loaded in production unless you opt in**
   with `BOOTSTRAP_SEED_DEMO_DATA=true` (unset: loaded on a developer machine / in tests, never in production; `false`:
   never). A customer installation therefore starts with no business data. The SQL files stay in the repository for
   reference; `seed-units-random.sql` (random test units) is intentionally not part of initialization.

Every step is find-or-create on the row's natural key (code, name, email, or property + unit number), including
soft-deleted rows: a database that already holds part of this data is completed, never duplicated or overwritten.

After the transaction commits, the registration document rules are ensured and the IAM synchronization runs (see
below). If one of those fails, the data is already committed and the next start repeats them through the
existing-database path.

The admin user's identity comes from three environment variables:

| Variable | Required | Default if unset |
|---|---|---|
| `DEFAULT_ADMIN_EMAIL` | **Yes in production** | `admin@ccb.local` outside production only — production refuses an unset value and this example address |
| `DEFAULT_ADMIN_NAME` | No | `System Administrator` |
| `DEFAULT_ADMIN_PASSWORD` | **Yes**, when the account is created (not with `BOOTSTRAP_SEED_ADMIN=false`) | — |

**`DEFAULT_ADMIN_PASSWORD` is mandatory** whenever bootstrap creates the account. There is no hardcoded, fallback, or auto-generated
password anywhere in this codebase. If it is missing on a fresh database, bootstrap throws and the
application refuses to start — add it to your `.env` file and restart. It must meet the password policy, it is only a
**temporary** password (the account must replace it at its first sign-in), and it is hashed with
bcrypt (12 rounds) before being stored; it is never logged or printed.

After the user and role are created, bootstrap grants the Super Admin role its permissions (see
below) and logs that the account must set its own password at its first sign-in and that `DEFAULT_ADMIN_PASSWORD`
should then be removed from the environment (a production start that still finds it warns again).

**The first administrator is protected.** The installation's initial `SUPER_ADMIN` — the oldest active holder of the role — cannot be
deleted, deactivated, demoted or have its sign-in disabled through the application, and no `SUPER_ADMIN` can ever be left without a
successor. Handing it over is a deliberate, server-side step (`npm run maintenance:super-admin -- --retire …`); see
[docs/ON_PREMISE_SUPER_ADMIN.md](docs/ON_PREMISE_SUPER_ADMIN.md) §4.1 and §7.

### How the Super Admin actually gets its access

This is deliberately split into two independent mechanisms. Conflating them would overstate what
either one does, so both are described separately and accurately:

**1. SUPER_ADMIN's system policy (every `@Permission(...)` route — the vast majority of the app).**
Authorization on `@Permission(...)` routes is resolved only from policies: the policies attached to the
user's roles, those roles' inline policies and the user's own inline policies
(`IamService.getActionCodesGrantedByPoliciesForRoles`), with no special case for any role name.
`IamService.ensureAdminPolicyGrants()` runs on every application boot — fresh install and every
subsequent restart — creates the system-managed `SUPER_ADMIN Policy` if needed, attaches it to the
`SUPER_ADMIN` role and to no other role (it is the only predefined role; no other role name is looked
up, assumed or auto-granted), and keeps it holding every currently-active action except the business
approvals below. This is genuine grant data: you can query `policy_statements` and see exactly what
SUPER_ADMIN holds. `RolePermissionsService.ensureAdminGrants()` also runs on every boot and inserts one
legacy `role_permissions` row per (SUPER_ADMIN, action) pair; those rows are the older permission tree and
do not decide access on `@Permission(...)` routes.

**Business-transaction approvals are deliberately NOT granted to `SUPER_ADMIN`** — it administers the
system, it does not decide business records. The approve/reject codes listed in
`src/modules/iam/business-approval-actions.ts` (tariff, billing cycle, bill run, registration request
and meter reading) are skipped by this automatic grant, and the permission resolver withholds them from
any account that holds `SUPER_ADMIN`. They are granted to business roles — which `SUPER_ADMIN` creates
dynamically — through policies. `WORKFLOW_MANAGE_APPROVERS` (choosing which roles approve) is system
configuration and is granted to `SUPER_ADMIN` like any other administrative action. See
[docs/SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md), section 10.

**2. A hardcoded role-name bypass (a small set of routes only).**
A handful of routes use the older `@Roles(...)` decorator (role-name matching) instead of
`@Permission(...)` — for example, the Policy administration controllers are restricted to
`SUPER_ADMIN` at the class level (the Roles controller is permission-based now). For these specific routes, `RolesGuard` contains an explicit
code-level bypass: a request from a user whose role name is `SUPER_ADMIN` is always allowed,
regardless of whether any `role_permissions` row exists. This is not grant data — it is a
condition in the guard's own code — and it only applies to `@Roles(...)`-protected routes, not to
the `@Permission(...)`-protected routes described above.

In short: most of what Super Admin can do is backed by real, queryable policy rows (its system policy); a
small, specific set of routes trust the `SUPER_ADMIN` role name directly in code.

### Re-running bootstrap against an existing database

Every subsequent application start checks the same `users` table — counting **every** user row, soft-deleted and deactivated accounts
included. If it is non-zero, the full seed (roles, Super Admin user, locations) is **never run again** — so a repeated start can never create a
second default administrator — only the pending migrations (above) and a set of idempotent backfill
calls run: `ensureCriticalDefaults()` for modules/sub-modules/screens/actions/LOVs/attributes, plus
the same `ensureAdminGrants()` call described above and its Policy-model counterpart
`IamService.ensureAdminPolicyGrants()`. No existing role, user or data is ever renamed or rewritten by a start.

Every one of those backfill calls checks for an existing row before inserting — `ensureAdminGrants`
skips any (role, action) pair that already has a grant row; `ensureLeafModuleGrants` does the same.
None of them ever delete or modify an existing user, role, or grant. The one deliberate exception:
`ensureAdminPolicyGrants` also removes the business-approval codes from SUPER_ADMIN's own system policy.
No other role — whatever it is called — is ever touched. Running the application against a database that
already has data in it is safe to do as many times as needed: it adds the rows that are missing and
otherwise changes nothing.

### Setting it up

1. Copy `.env.example` to `.env`.
2. Set a random `JWT_SECRET` of at least 32 characters (do not commit this file) and choose how the first administrator is created:
   * **temporary password in the environment:** `DEFAULT_ADMIN_PASSWORD` = a password that meets the password policy (at least 12
     characters, at most 72 UTF-8 bytes — bcrypt ignores anything longer — and at least 3 of uppercase / lowercase / number / symbol) and
     `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_NAME`. In production the e-mail **must** be the real address of the person who will administer the
     installation — the example address `admin@ccb.local` is refused. The account must set its own password at first sign-in; **remove
     `DEFAULT_ADMIN_PASSWORD` from the file afterwards.**
   * **no password in any file:** `BOOTSTRAP_SEED_ADMIN=false`, then create the first administrator on the server with
     `npm run maintenance:super-admin -- --email … --name "…" --apply` (one-time password printed once).

   Leave `BOOTSTRAP_SEED_DEMO_DATA` unset for a customer installation (no sample business data in production); set it to `true` only
   for a demo or training installation.
3. Start ONE instance of the application against an empty database (the migrations, then bootstrap, run
   automatically; do not start several instances at once on a brand-new database — migrations and the first
   seed are not coordinated between processes).
4. Sign in with the e-mail and the temporary password; the application asks for a new password immediately.
5. Create a second `SUPER_ADMIN` (two named people) and the delegated administrators you need — see
   [docs/ON_PREMISE_SUPER_ADMIN.md](docs/ON_PREMISE_SUPER_ADMIN.md) §6.

## Security

How authorization, SUPER_ADMIN protection, sessions and configuration are hardened — and the actions only an operator can take (rotating secrets, database accounts, env files) — is in [docs/SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md). Every environment variable is listed in `.env.example`.
