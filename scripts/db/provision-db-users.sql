-- =====================================================================================================
-- CCB API — least-privilege MySQL accounts.            DO NOT RUN AS-IS: replace every __PLACEHOLDER__.
-- =====================================================================================================
-- Why: the API used to connect as `root` (or one account that can do anything). A SQL-injection bug or a
-- leaked .env then meant a full database takeover. The running API only needs to read and change DATA,
-- so it gets an account that can do exactly that; schema changes (migrations) use a second account that
-- is only used when a migration is run by an operator.
--
-- Who runs this: a DBA, with a privileged account, ONCE per environment, then the .env file of that
-- environment is updated by hand (this repository never contains a real password). Nothing in this
-- script is executed by the application, by the tests or by any npm script.
--
-- Placeholders
--   __DB_NAME__            the application schema (DB_DATABASE), e.g. the one the API already uses
--   __API_HOST__           the host the API connects FROM (the application server), not '%'
--   __OPS_HOST__           the host migrations are run from (a deploy machine / the app server)
--   __APP_PASSWORD__       a freshly generated password for the API account  (openssl rand -base64 33)
--   __MIGRATION_PASSWORD__ a different freshly generated password for the migration account
-- Use a DIFFERENT pair of passwords in every environment; never reuse an old/shared one.
-- =====================================================================================================

-- 1. The account the running API uses (DB_USERNAME / DB_PASSWORD): data only. No CREATE / ALTER / DROP /
--    INDEX / REFERENCES — it cannot change the schema, drop a table or create further accounts.
--    (SELECT ... FOR UPDATE, used for the last-SUPER_ADMIN and role-change locks, needs only these.)
CREATE USER IF NOT EXISTS 'ccb_app'@'__API_HOST__' IDENTIFIED BY '__APP_PASSWORD__';
GRANT SELECT, INSERT, UPDATE, DELETE ON `__DB_NAME__`.* TO 'ccb_app'@'__API_HOST__';

-- 2. The account the migration CLI uses (DB_MIGRATION_USERNAME / DB_MIGRATION_PASSWORD, read only by
--    src/config/data-source.ts for `npm run migration:run` / `migration:revert`). It can change the
--    schema, but only inside this one database, and it is not used by the running API.
CREATE USER IF NOT EXISTS 'ccb_migrator'@'__OPS_HOST__' IDENTIFIED BY '__MIGRATION_PASSWORD__';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
  ON `__DB_NAME__`.* TO 'ccb_migrator'@'__OPS_HOST__';

-- 3. Check what each account can really do (read the output; nothing here should mention `*.*`, GRANT
--    OPTION, SUPER, FILE or PROCESS).
SHOW GRANTS FOR 'ccb_app'@'__API_HOST__';
SHOW GRANTS FOR 'ccb_migrator'@'__OPS_HOST__';

-- 4. Switch the API over, in this order, and only then retire the old broad account:
--    a. In the environment's .env file set DB_USERNAME=ccb_app and DB_PASSWORD=<the new password>,
--       DB_MIGRATION_USERNAME=ccb_migrator and DB_MIGRATION_PASSWORD=<the new password>, and
--       DB_MIGRATIONS_RUN=false (the API account cannot run DDL; migrations are applied by an operator
--       with `npm run migration:run`, which uses the migration account).
--    b. Apply any pending migrations once with that command, then start the API and confirm it works.
--    c. Rotate (or drop) the account the API used before, and the root password if the API ever used it:
--         ALTER USER '<old-user>'@'<host>' IDENTIFIED BY '<new random password>';   -- or: DROP USER ...
--
-- Boot-time index services: two services under src/common/migrations (meter uniqueness and meter-reading
-- uniqueness) run `ALTER TABLE ... ADD/DROP INDEX` at start-up WHEN AN INDEX IS MISSING and log (not
-- throw) a failure. On a database where those indexes already exist they do nothing, so the
-- DML-only account is fine. On a brand-new database, start the API ONCE with the migration account's
-- credentials in DB_USERNAME / DB_PASSWORD (so the indexes can be created), then switch to ccb_app.
--
-- Rotating a password later:
--   ALTER USER 'ccb_app'@'__API_HOST__' IDENTIFIED BY '__NEW_APP_PASSWORD__';
-- then update DB_PASSWORD in that environment's .env file and restart the API.
