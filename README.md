# CCB API

NestJS backend for the CCB billing platform.

## Default Super Admin & Initial Permissions

This section documents exactly what happens the first time the application connects to a
database, and what happens on every run after that. It describes the real behavior in
`src/bootstrap/bootstrap.service.ts` and `src/modules/role-permissions/role-permissions.service.ts`
— nothing here is approximate.

### Fresh database (first ever boot)

`BootstrapService.onApplicationBootstrap()` checks whether the `users` table has any rows at all.
If it is empty, this is treated as a brand-new install and the following happens, inside one
database transaction:

1. Every module, sub-module, screen, and action (the full permission tree) is seeded from
   `src/bootstrap/seed-data.ts`.
2. The system's fixed set of roles is created — `SUPER_ADMIN`, `FINANCE`, `OPERATIONS`,
   `CUSTOMER_SUPPORT`, `CUSTOMER_SERVICE_EXECUTIVE`, `CUSTOMER_SERVICE_SUPERVISOR`, `CUSTOMER`.
3. **One Super Admin user is created and assigned the `SUPER_ADMIN` role.**

The admin user's identity comes from three environment variables:

| Variable | Required | Default if unset |
|---|---|---|
| `DEFAULT_ADMIN_EMAIL` | No | `admin@ccb.local` |
| `DEFAULT_ADMIN_NAME` | No | `System Administrator` |
| `DEFAULT_ADMIN_PASSWORD` | **Yes** | — |

**`DEFAULT_ADMIN_PASSWORD` is mandatory.** There is no hardcoded, fallback, or auto-generated
password anywhere in this codebase. If it is missing on a fresh database, bootstrap throws and the
application refuses to start — add it to your `.env` file and restart. The password is hashed with
bcrypt (12 rounds) before being stored; it is never logged or printed.

After the user and role are created, bootstrap grants the Super Admin role its permissions (see
below) and logs a warning to change the default password after first login.

### How the Super Admin actually gets its access

This is deliberately split into two independent mechanisms. Conflating them would overstate what
either one does, so both are described separately and accurately:

**1. Real, individual `role_permissions` rows (the vast majority of the app).**
`RolePermissionsService.ensureAdminGrants()` runs on every application boot — fresh install and
every subsequent restart — and inserts one concrete `role_permissions` row per (role, action) pair
for every currently-active action, for the `SUPER_ADMIN` role (and `ADMIN`, if such a role is ever
created — none is seeded by default). This is genuine grant data: you can query `role_permissions`
and see a row for every action SUPER_ADMIN holds. Every route guarded by `@Permission(...)` —
which is most of the API — is enforced purely by checking for these real rows, with no special
case for any role name.

**Eight action codes are deliberately excluded from this automatic grant**, as a segregation-of-duties
control — even the Super Admin does not get these for free:

- `TARIFF_APPROVE`, `TARIFF_REJECT`
- `BILLING_CYCLE_APPROVE`, `BILLING_CYCLE_REJECT`, `BILLING_CYCLE_APPROVAL_APPROVE`, `BILLING_CYCLE_APPROVAL_REJECT`
- `BILL_RUN_APPROVE`
- `WORKFLOW_MANAGE_APPROVERS`

The first seven gate real financial approve/reject actions; the last one gates who else can be
granted those approve actions. All eight must be granted explicitly through the Roles &
Permissions screen (or the Workflow screen's approver assignment), even to Super Admin. The one
exception: `ensureSuperAdminGrant('WORKFLOW_MANAGE_APPROVERS')` grants that one specific excluded
code to `SUPER_ADMIN` only (never `ADMIN`) on every boot, so there is always at least one account
that can configure approvers — it still has none of the other seven excluded codes automatically.

**2. A hardcoded role-name bypass (a small set of routes only).**
A handful of routes use the older `@Roles(...)` decorator (role-name matching) instead of
`@Permission(...)` — for example, the Roles & Permissions controller itself is restricted to
`ROLES.ADMIN` at the class level. For these specific routes, `RolesGuard` contains an explicit
code-level bypass: a request from a user whose role name is `SUPER_ADMIN` is always allowed,
regardless of whether any `role_permissions` row exists. This is not grant data — it is a
condition in the guard's own code — and it only applies to `@Roles(...)`-protected routes, not to
the `@Permission(...)`-protected routes described above.

In short: most of what Super Admin can do is backed by real, queryable permission rows; a small,
specific set of routes trust the `SUPER_ADMIN` role name directly in code.

### Re-running bootstrap against an existing database

Every subsequent application start checks the same `users` table count. If it is non-zero, the
full seed (roles, Super Admin user) is **never run again** — only a set of idempotent backfill
calls run: `ensureCriticalDefaults()` for modules/sub-modules/screens/actions/LOVs/attributes, plus
the same `ensureAdminGrants()` / `ensureSuperAdminGrant()` calls described above.

Every one of those backfill calls checks for an existing row before inserting — `ensureAdminGrants`
skips any (role, action) pair that already has a grant row; `ensureSuperAdminGrant` and
`ensureLeafModuleGrants` do the same. None of them ever delete or modify an existing user,
role, or grant. Running the application against a database that already has data in it is safe to
do as many times as needed — it only ever adds rows that are missing, never removes or overwrites
anything that already exists.

### Setting it up

1. Copy `.env.example` to `.env`.
2. Set `DEFAULT_ADMIN_PASSWORD` to a real password (do not commit this file).
3. Optionally set `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_NAME`.
4. Start the application against an empty database. Bootstrap runs automatically.
5. Log in with the email/password you set, and change the password immediately.
