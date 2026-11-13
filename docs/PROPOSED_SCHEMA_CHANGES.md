# Proposed database changes — nothing here has been made

> **Status (2026-11-11): PROPOSAL ONLY.** No migration, SQL statement or database operation was executed, written into `src/migrations/`, or run by this work, and **none will be until you approve it**. A file in `src/migrations/` runs on the next start of any installation that has migrations on, so the proposals below live only in this document.
> This release itself needs **no schema change**: the protected initial administrator, the assignment boundary, the demo-data switch and the `--retire` tool are all derived at run time from existing tables.

| # | Proposal | Needed for | State | Decision |
|---|---|---|---|---|
| 1 | New tables `account_invitations` and `email_templates` (**replace** the earlier `user_invitations` proposal) | e-mail invitations for staff **and** customers, and the managed e-mail templates they use | **DONE on the local development database (2026-11-12)** — migration `src/migrations/1795600000000-…` applied, modules registered; other environments get it when the new version starts (§1) | approved and executed |
| 2 | Stored "installation owner" marker | making "initial administrator" a stored fact | **not proposed** — derived instead (§2) | none needed |
| 3 | The two `SUPER_ADMIN_*` attributes | nothing — they are unused settings | **reviewed, left alone** (§3) | keep or retire |
| 4 | Restoring the role row on a database where it was renamed or removed outside this release | recovery | contingency SQL, **not executed** (§4) | only if it applies to you |

## 1. `account_invitations` and `email_templates` — e-mail invitations and templates (created 2026-11-12)

> **This replaces the earlier `user_invitations` proposal** (administrators only, with a foreign key to `users`). The invitation system was built for **staff and customers** through one mechanism, with e-mail templates managed on their own screen, so it needs these two tables instead; the old draft is no longer proposed. Design, security properties and the activation steps are in [INVITATIONS_AND_EMAIL_TEMPLATES.md](INVITATIONS_AND_EMAIL_TEMPLATES.md). **Activated 2026-11-12:** the modules are registered in `AppModule`, `sanitize-html` is installed, and the migration ran on the local development database (72 → 74 tables; no existing table, column, index or key changed). A DEV/UAT/production database receives the two tables the first time the new version of the API starts with migrations on (the default) — back it up first; the steps are in [INVITATIONS_AND_EMAIL_TEMPLATES.md](INVITATIONS_AND_EMAIL_TEMPLATES.md) §3.

**Why.** Today a new administrator account gets a *temporary password* that the creating `SUPER_ADMIN` must pass on, and the holder must replace it at the first sign-in (the API refuses everything else until they do). An invitation removes the hand-over: the account is created **without a password**, an e-mail carries a **single-use link that works for 24 hours**, and the holder chooses their own password through it. Customers keep coming only from registration and approval; their activation e-mail becomes the same kind of invitation (links issued the old way keep working until they expire). It needs the customer's SMTP settings, and the two existing password options of Create User stay exactly as they are.

**Table `account_invitations`** — one row per invited account:

| Column | Type | Meaning |
|---|---|---|
| `id` | `int` PK, auto-increment | |
| `principal_type`, `principal_id` | `varchar(10)`, `int` — **unique together** | `staff` or `customer`, and that account's id. No foreign key (the convention of `refresh_tokens` and `user_devices`): a staff id and a customer id are separate id spaces |
| `email`, `recipient_name` | `varchar(160)`, `varchar(200)` | the address the link was sent to and the person's name, as they were when it was issued (acceptance is refused if the account's address changed since) |
| `token_hash` | `char(64)`, **unique** | SHA-256 of the one-time token. The token itself is **never stored**, and neither is a password |
| `status` | `varchar(10)`, default `PENDING` | `PENDING`, `ACCEPTED`, `EXPIRED`, `CANCELLED` |
| `expires_at` | `datetime(6)` | issue time + 24 h, stamped and compared with the **database** clock |
| `accepted_at`, `cancelled_at`, `cancel_reason`, `expired_notified_at` | `datetime(6)` / `varchar(40)`, nullable | lifecycle stamps; `expired_notified_at` makes the "Invitation Expired" e-mail go out once |
| `sent_count`, `last_sent_at`, `last_send_error` | `int` default 0, `datetime(6)` null, `varchar(400)` null | delivery bookkeeping and the resend limits; the error text never holds a link or token |
| `created_by` | `int NULL` | the staff user who issued it (null: the system did, on an approved registration) |
| `created_at`, `updated_at` | `datetime(6)` | |
| indexes | `UNIQUE (principal_type, principal_id)`, `UNIQUE (token_hash)`, `INDEX (status, expires_at)` | |

**Table `email_templates`** — the messages those invitations use: `id`; `template_key varchar(60)` + `locale varchar(5)` (**unique together**); `name varchar(120)`; `subject varchar(300)`; `body_html mediumtext`; `body_text mediumtext NULL`; `is_active tinyint` default 1; `is_system tinyint` default 0; `updated_by int NULL`; `created_at`, `updated_at`. On the first start after activation the twelve built-in templates (six messages × English/Arabic) are written if missing and never overwritten. The e-mail **branding** (company name, logo address, header and button colours, a footer sentence per language) needs **no table**: each is a SYSTEM attribute row created the first time an administrator saves it (`COMPANY_NAME`, `EMAIL_LOGO_URL`, `EMAIL_HEADER_COLOR`, `EMAIL_BUTTON_COLOR`, `EMAIL_FOOTER_TEXT_EN`, `EMAIL_FOOTER_TEXT_AR`), so nothing is written to the database before that.

Both add **no column to, and change no row of, any existing table**, and create **no foreign key**. `down()` drops a table only while it is empty. The migration is `src/migrations/1795600000000-CreateAccountInvitationsAndEmailTemplates.ts` (idempotent: it checks each table first); the entities and the migration are identical, so TypeORM's own schema comparison reports no pending change for them.

**Not to be confused with a leftover table.** The paused SaaS experiment (reverted 2026-11-10; see the banner in [SAAS_IMPLEMENTATION_CHECKLIST.md](../SAAS_IMPLEMENTATION_CHECKLIST.md)) created a `user_invitations` table in the **local development** database, with a different shape (it carried the organization). The new feature uses other names and never reads, alters or drops it, so that leftover no longer blocks anything; it can stay or be dropped separately, deliberately.

**What approval would involve** (none of it done — each step needs its own approval): check each database first that neither new table already exists with another shape; `npm install sanitize-html` in `CCB API`; create the tables — in development `synchronize` does it from the entities, anywhere else move the migration into `src/migrations/` and run it deliberately; register `EmailTemplateModule` and `AccountInvitationModule` in `AppModule`; configure `STAFF_PORTAL_URL`/`CUSTOMER_PORTAL_URL` and SMTP; restart. **Until then, one caveat:** `src/config/data-source.ts` (the TypeORM CLI's data source) globs every `*.entity.ts`, so `npm run migration:generate` run before activation would see these two entities and propose `CREATE TABLE` statements for them — do not commit that output (the reviewed migration is the one in `migrations-proposed`). Excluding the two files from that glob is possible if you prefer; it is a change to shared infrastructure, so it was left for your decision.

**Decision for you:** approve the two tables and the activation steps, or decline and keep the temporary-password hand-over.

## 2. An "installation owner" marker — not proposed

The brief asked for a protected **initial** `SUPER_ADMIN`. It is implemented **without schema**: the initial administrator is the **lowest-id active, non-deleted holder** of `SUPER_ADMIN` (`UserRoleService.initialAdministratorId`). User ids only grow, so that is the account created first; if that account is retired through the server maintenance tool, the protection passes by itself to the next-oldest active administrator.

A stored marker (a column on `users`, say `is_installation_owner`) would make the fact explicit and let the owner be chosen rather than inherited, at the price of a schema change, a backfill for existing installations (which would still have to *choose* one account) and a second thing to keep consistent. It would also remove one quirk of the derived rule: because "initial" means *the oldest active holder*, re-activating an older retired administrator makes it the initial one again and the one that had moved up loses the protection (the maintenance tool's retire clears the password to blunt this — [ON_PREMISE_SUPER_ADMIN.md](ON_PREMISE_SUPER_ADMIN.md) §4.1). It is not needed for the protection to work, so it is **not proposed** — say so if you want it anyway.

## 3. The `SUPER_ADMIN_*` attributes — reviewed, not retired

You asked that these not be retired without a usage review. The review:

| | `SUPER_ADMIN_REVOKE_AFTER_CYCLE_CLOSE` | `SUPER_ADMIN_FORCE_TARIFF_ACTIVATION` |
|---|---|---|
| Label (as shown on the Attributes screen) | "Super Admin Revoke After Cycle Close" | "Super Admin Force Tariff Activation" |
| Kind | `SYSTEM`-scope boolean, default `true` ("Allowed with justification" / "Blocked") | same |
| Defined in | `src/modules/attribute/attribute.constants.ts` (`ATTRIBUTE_KEY`), seeded by `attribute.service.ts` | same |
| Anything that **reads the value** | **nothing** in the API or in the web — a search of both for the key, the label and the constant finds only the definition, the seed row and the list below | **nothing** |
| Anything that **uses the name** | `CYCLE_SENSITIVE_KEYS` in `attribute.service.ts`: editing the value requires a *reason for change* (409 otherwise) | same |
| Migrations or specs mentioning it | none | none |

So the two settings are visible and editable on the Attributes screen but **control nothing**. (`FINANCE_OVERRIDE_VALIDATION_AT_BILL_RUN`, a third attribute in the same list, is in the same position.) Because the role stays `SUPER_ADMIN`, the names carry no naming conflict any more.

**Recommendation: leave them.** Retiring them is a data change (the rows live in `attributes`, and the keys are never to be changed "without a data migration" per `attribute.constants.ts`) and removing a setting that an installation may have edited is not something to do silently. If you want them gone, it should be a reviewed migration that deletes the rows together with the other unused attribute, after you confirm that no customer relies on them. **Nothing was changed.**

## 4. Contingency — the `SUPER_ADMIN` role row is missing or renamed

An initialized database is **never re-seeded**, and this release **renames nothing**. If, outside this release, the role row was renamed or removed (for example by hand, or by the interim, never-released `GLOBAL_ADMIN` experiment on a developer database), nobody holds `SUPER_ADMIN`, the maintenance tool refuses (it needs the role row), and the row has to be put back. Identify the role by **who holds it**, not by guessing:

```sql
-- READ-ONLY. Which role do your administrators actually hold?
SELECT r.id, r.role_name, COUNT(ur.id) AS holders
  FROM roles r LEFT JOIN user_roles ur ON ur.role_id = r.id
 GROUP BY r.id, r.role_name ORDER BY holders DESC;
```

*If* the administrators hold a role named `GLOBAL_ADMIN` and no `SUPER_ADMIN` role exists (take a backup first; this is **not** part of any release and was **not run**):

```sql
START TRANSACTION;
UPDATE roles SET role_name = 'SUPER_ADMIN'
 WHERE role_name = 'GLOBAL_ADMIN' AND deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM roles WHERE role_name = 'SUPER_ADMIN') r);
UPDATE policies SET name = 'SUPER_ADMIN Policy'
 WHERE name = 'GLOBAL_ADMIN Policy' AND is_system = 1
   AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM policies WHERE name = 'SUPER_ADMIN Policy') p);
COMMIT;
```

The role keeps its id, so every holder and every attached policy follows; no `user_roles`, `role_policies` or user row is touched. Sessions are unaffected (authorization reads live role names). On the next start the system policy is re-synchronised by `ensureAdminPolicyGrants`.

## 5. What this release does to a database

* **Schema:** nothing.
* **Data, existing installation:** nothing new — a start on an initialized database runs only the idempotent backfills it always ran (missing catalogue rows, lists of values, attributes, and the re-synchronisation of the system-managed `SUPER_ADMIN` policy: missing action codes added, business-approval codes stripped, description refreshed), and renames or rewrites no role, user, custom policy or account.
* **Data, fresh installation:** the first start seeds the catalogue, lists of values, attributes, the `SUPER_ADMIN` role and — unless `BOOTSTRAP_SEED_ADMIN=false` — the one default administrator; sample business data **only** with `BOOTSTRAP_SEED_DEMO_DATA=true` (never in production by default).
* **The maintenance tool** (`npm run maintenance:super-admin`) writes only when run with `--apply`, by the person who owns the server.
