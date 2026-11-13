# CCB API — operations guide

For the person who installs, runs and upgrades a CCB installation. CCB is on-premises software: one installation, one database, one set of secrets per
customer (docs/ON_PREMISE_SUPER_ADMIN.md). Everything here is about running **this** installation safely. The security model is in
docs/SECURITY_HARDENING.md; the first administrator and recovery are in docs/ON_PREMISE_SUPER_ADMIN.md.

> Sections are added as the platform grows; each one states what is configured by an environment variable and what by the application itself.

## 1. Requirements

| Component | Supported | Notes |
|---|---|---|
| **Node.js** | **22 LTS or 24 LTS** | See "Node.js" below. |
| MySQL | 8.0 or newer | `utf8mb4`. The runtime account should be data-only (`scripts/db/provision-db-users.sql`). |
| Redis | optional | The API runs without it (lock-out counters and caches fall back to the memory of one process). Needed to share them between several API instances. Never expose it beyond the server. |
| Mail server (SMTP) | needed for invitations and e-mail notices | `SMTP_*` in the environment file. |

### Node.js

CCB is built and tested on the Node.js LTS lines listed in `package.json` → `engines` (currently **22 and 24**), verified by the CI matrix. A Node.js
release that has reached its **end of life** no longer receives security fixes; the API logs a warning at every start when it runs on one, and
`ENFORCE_SUPPORTED_NODE=true` makes it refuse to start instead. The console's *Application Information* screen shows the same verdict.

| Node.js | End of life | Status for CCB |
|---|---|---|
| 20 | 2026-04-30 | **past end of life** — upgrade |
| 22 | 2027-04-30 | supported |
| 24 | 2028-04-30 | supported |
| 26 | 2029-04-30 | not yet in the CI matrix ("not one of the versions CCB is tested on") |

The table lives in `src/config/node-support.ts` (and, for the console, `CCB_Web/lib/constants/application-info.constants.ts`): add a row when a new major
is released.

*Upgrading the server's Node.js.* Install Node 22 or 24 (a package from your OS vendor, the NodeSource repositories, `nvm`/`fnm`, or the Windows
installer), then in the API folder: `npm ci` (it rebuilds the native modules for the new version), `npm run build`, `npm run preflight`, restart. The
repository's `.nvmrc` names the version developers use. **One dependency is pinned for Node 20:** `sanitize-html` is held at exactly `2.17.5` because
later releases require Node ≥ 22.12 (e-mail template HTML is cleaned with it). Once every machine that runs the API is on Node 22.12+, the pin can be
lifted with `npm install sanitize-html@latest` followed by the test suite.

## 2. Build, check and start

```
cd "CCB API"
npm ci                      # installs the locked dependencies (dev dependencies too: the build needs the TypeScript compiler)
npm run build               # nest build -> dist/
npm run build:check         # verifies the result (see below); add -- --strict to fail on warnings as well
npm run preflight           # verifies the CONFIGURATION and the connections (read-only; see section 3)
npm run start:prod          # node dist/src/main
```

**Where the entry point is.** The build puts the application in `dist/src/` and the operational scripts in `dist/scripts/` — a consequence of
`tsconfig.build.json` (`rootDir: "."`, `include: ["src", "scripts"]`). `start:prod` therefore runs `node dist/src/main`; the pre-start check
(`prestart:prod`) says so plainly if the build is missing. Do not "tidy" `rootDir` away: without it the compiler picks the layout from whatever
files it finds, and a one-file change can silently move the entry point. `npm run build:check` (also run in CI) fails if the layout drifts, if a
compiled file still needs the `@app/*` path alias (only `nest build` rewrites it — a plain `tsc` build does not), if a migration was not
compiled, or if compiled code remains for a source file that no longer exists (delete `dist/` and rebuild before deploying).

**Environment file.** The process reads the file named by the `APP_ENV` variable of the process itself: unset → `.env`, `dev` → `.env.dev`, any other
name → `.env.<name>` (it must exist). Start-up refuses weak or placeholder secrets, the `root` database account and `DB_SYNCHRONIZE` outside a
developer machine, and reports **key names only**, never values.

**Database migrations.** By default the API applies pending migrations when it starts (`DB_MIGRATIONS_RUN`, default on). For a least-privilege setup
(runtime account without schema rights) set `DB_MIGRATIONS_RUN=false` and apply them with a privileged account before starting the new version:

```
npm run migration:run:prod      # compiled: typeorm migration:run -d dist/src/config/data-source.js  (uses DB_MIGRATION_USERNAME/PASSWORD when set)
npm run migration:revert:prod   # reverts the LAST migration
```

`GET /health/ready` answers 503 while a migration is pending, so a load balancer never routes to an instance whose schema is behind.

## 3. Pre-flight check

`npm run preflight` (compiled: `npm run preflight:prod`) answers "will this start, and is it safe to run?" before you start or upgrade. It is read-only:
it reads the environment file the API would read, connects to the database and Redis, and prints a verdict per check — environment class, Node.js
support, the start-up validation rules, CORS origins and cookie flags, reverse-proxy setting, Swagger, build output, mail server, database connection,
pending migrations, the database account's privileges, **the `audit_logs` append-only triggers (§7)**, Redis. Secrets are never printed. `-- --json`
prints machine-readable output for a deployment pipeline, `-- --strict` fails on warnings, `-- --skip-db` checks the configuration only. Exit code
0 = ready, 1 = at least one failure.

## 4. Health, readiness and shutdown

Two **public**, unauthenticated, un-versioned endpoints (outside the `/api/v1` prefix) for orchestrators, load balancers and uptime monitors. They answer
with a bare status and never reveal versions, hosts or error text; they are exempt from the request throttle.

| Endpoint | Meaning | Answers |
|---|---|---|
| `GET /health/live` | The process is running. Never checks a dependency, so a database outage does not make a supervisor restart a healthy process. | `200 {"status":"ok"}` |
| `GET /health/ready` | The instance should receive traffic: the database answers (1.5 s), no migration is pending, and the process is not shutting down. Redis is optional — if it is down the answer is `degraded`, still HTTP 200. | `200 {"status":"ok"\|"degraded","checks":{…}}` · `503 {"status":"unavailable","reason":"database-down"\|"migrations-pending"\|"shutting-down"}` |

Answers are cached for 2 seconds (the pending-migration question for 60), so any number of monitors costs the database about one query per two seconds.
The signed-in detail view is *System Health* in the console (SUPER_ADMIN).

```nginx
# nginx upstream health check (open-source nginx: passive checks only; use an active check in HAProxy / the cloud load balancer)
location = /healthz { proxy_pass http://127.0.0.1:4000/health/ready; access_log off; }
```
```
# HAProxy:   option httpchk GET /health/ready      http-check expect status 200
# Docker:    HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Kubernetes: livenessProbe httpGet /health/live · readinessProbe httpGet /health/ready
```

**Graceful shutdown.** On `SIGTERM` / `SIGINT` (a service manager's stop, `docker stop`, `pm2 stop`) the API shuts down in order: readiness flips to
`503 shutting-down` first, so a load balancer stops routing to it; it then waits `SHUTDOWN_DRAIN_MS` (default 0 — set a few seconds when a load balancer
polls less often than that); then Nest closes the HTTP server, the scheduled jobs, the database pool and the Redis connection. If the close hangs, the
process is forced to exit after `SHUTDOWN_TIMEOUT_MS` (default 15000). Give the service manager a stop timeout longer than both (systemd
`TimeoutStopSec=30`). On Windows a plain service stop cannot deliver SIGTERM to Node.js; stop through the service wrapper's own graceful mechanism
(for example NSSM's "Console" shutdown with Ctrl+C) or accept an abrupt stop.

## 5. Reverse proxy and `TRUST_PROXY`

Put the API behind a reverse proxy (nginx, IIS ARR, HAProxy, a cloud load balancer) to terminate TLS. **Then `TRUST_PROXY` must be set**, and only then:

* **Unset behind a proxy** — every user arrives from the proxy's address. The sign-in lock-out and the request throttle (both keyed by client IP) treat the
  whole organisation as one client, so a few mistyped passwords lock everybody out, and the sign-in history records the proxy instead of the person. The
  API logs a warning when it sees `X-Forwarded-For` while `TRUST_PROXY` is unset.
* **`true` (trust everybody)** is refused at start-up: any client could then send its own `X-Forwarded-For` and choose the address it is rate-limited
  and locked out under.

Valid values: a hop count (`1` = one proxy in front of the API), `loopback`, or a comma-separated list of IP addresses / CIDR ranges
(`10.0.0.0/8, 192.168.1.5`). The proxy must **set** (not append blindly to) the header:

```nginx
location /api/ {
    proxy_pass         http://127.0.0.1:4000;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-For   $remote_addr;      # overwrite what the client sent
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    client_max_body_size 20m;                                # document uploads
}
```

With TLS terminated at the proxy, also set `COOKIE_SECURE=true` and list the web application's **https** origin in `CORS_ORIGINS`. When the web application
and the API are on different sites, use `COOKIE_SAMESITE=none` (always `Secure`) or put both behind one origin (docs/SECURITY_HARDENING.md, §8 item 7).

## 6. Sign-in lock-out

Failed sign-ins are counted per account **and client** (default 10 per 15 minutes), per client IP (20), and per account across all clients (50 — *protected
mode*: only a client that signed in to the account within 30 days still gets through). The model, the audit events and the settings are in
docs/SECURITY_HARDENING.md (§3) and `.env.example` (`LOGIN_*`). The practical consequences:

* A stranger who keeps failing against an administrator's address locks **their own** client out of that account — never the administrator, who signs in
  from where they always do.
* **Lifting a lock.** A signed-in administrator opens the user's *Manage sign-in access* and chooses **Unlock sign-in** (`POST /auth/users/:id/unlock-signin`).
  When nobody can sign in, run on the server:

  ```
  npm run maintenance:unlock-signin -- --email admin@customer.example            # shows what is counted (dry run)
  npm run maintenance:unlock-signin -- --email admin@customer.example --apply    # clears it
  npm run maintenance:unlock-signin -- --ip 203.0.113.9 --apply                  # a locked client address
  # compiled: npm run maintenance:unlock-signin:prod -- …
  ```

  It deletes only the failed-attempt counters in Redis (never a password or an account) and writes an audit entry. Without Redis the counters live in the
  memory of the API process: they are cleared by restarting it, and expire by themselves after the window.
* Locks, protected mode and unlocks appear in the audit trail (module `security`); `LOGIN_FAILED` rows are capped (12 a minute per account, 200 overall), so
  an attack is visible without being able to flood the table.

## 7. Audit trail

Every audited change (`audit_logs`) is written through one of two services — `AuditService.record()` (business-module changes: who changed what, before
and after) or `SecurityEventService.record()` (module `security`: sign-ins, lock-outs, access refusals — `src/audit/audit.constants.ts` lists every
`SECURITY_EVENT`). Both only ever **insert**; neither has an update or delete method, and `AuditLogController` (`GET /audit-logs`, `GET /audit-logs/:id`,
SUPER_ADMIN only) has no write route. Read it in the console's *Audit and compliance* screen, or `GET /audit-logs` directly.

**Append-only, enforced at the database.** Two triggers on `audit_logs` (migration `1795700000000-AddAuditLogsAppendOnlyTrigger`) reject any `UPDATE` or
`DELETE` against the table outright (`SIGNAL SQLSTATE '45000'`), whichever account or code path attempts it. This is the actual security boundary — not
the runtime account's grants, which cannot exclude one table from its UPDATE/DELETE privilege (`scripts/db/provision-db-users.sql` explains why). Only
the migration account holds the `TRIGGER` privilege needed to create or drop them; the API's runtime account does not, so even a fully compromised
runtime credential cannot silently disable them to cover its tracks. `npm run preflight` checks both triggers exist on every start-up review (§3) and
**FAILs** if either is missing — apply the migration with the migration account (§2) if it does.

**Access-denied events.** A signed-in staff request refused with 403 by the authorization guards (RolesGuard, PermissionGuard, the SUPER_ADMIN account
protections, …) is written as `ACCESS_DENIED` (module `security`) by `AccessDeniedAuditService` (`src/common/security/access-denied-audit.ts`), mounted
as Express middleware in `main.ts` so it sees every route the same way. It records only the method, the matched route PATTERN (never a raw id, email or
query string) and the client address — never a request body or header. Capped at 20 a minute per user and 200 overall (the same shape as the sign-in
lock-out's caps above), and at most once a minute per user **and route**, so a script hitting every route it can reach stays visible without flooding
the table. `PASSWORD_CHANGE_REQUIRED` (and the reserved `MFA_ENROLLMENT_REQUIRED`, for when MFA enrollment is enforced the same way) are session-state
refusals, not authorization denials, and are never recorded here. Scoped to staff sessions only: a customer-portal 403 is not recorded, because
`audit_logs.performed_by` joins the `users` table and a Customer id is a separate id space (an account-invitations migration note explains this split)
— recording one would misattribute the row or leave the actor blank.
