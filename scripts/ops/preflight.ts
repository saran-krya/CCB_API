/**
 * PRE-FLIGHT: "will this configuration start, and is it safe to run?" — answered BEFORE the application is started or upgraded, on the server that will
 * run it. Read-only: it reads the environment file the API itself would read (APP_ENV picks it, see src/config/env-file.ts), opens a read-only
 * connection to the database and Redis, and prints a verdict per check. It never prints a secret (key NAMES only), never writes anything and never
 * changes the schema.
 *
 *   cd "CCB API"
 *   APP_ENV=<env> npm run preflight                       # a developer machine / a server with the dev dependencies
 *   APP_ENV=<env> npm run preflight:prod                  # from a build: node dist/scripts/ops/preflight.js
 *   npm run preflight -- --json                           # machine-readable (for a deployment pipeline)
 *   npm run preflight -- --strict                         # warnings fail the run too
 *   npm run preflight -- --skip-db                        # configuration only (no database / Redis connection)
 *
 * Exit code: 0 = no FAIL (and no WARN with --strict), 1 = at least one FAIL, 2 = the tool itself could not run.
 */
import { existsSync, statSync } from 'fs';
import { basename, join, resolve } from 'path';
import { config as loadDotenv } from 'dotenv';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { resolveEnvFilePath } from '../../src/config/env-file';
import { judgeNodeRuntime } from '../../src/config/node-support';
import { validateEnv } from '../../src/config/env.validation';
import { isTrustProxyValue } from '../../src/config/trust-proxy';
import {
  readBoolean,
  resolveAppEnvironment,
  resolveCorsOrigins,
  resolveRefreshCookieSettings,
  resolveSwaggerEnabled,
  resolveTrustProxy,
} from '../../src/config/runtime-config';
import { APP_ENVIRONMENT } from '../../src/common/constants/env.constants';

type Level = 'PASS' | 'WARN' | 'FAIL' | 'INFO';
interface Check {
  name: string;
  level: Level;
  detail: string;
}

const args = new Set(process.argv.slice(2));
const checks: Check[] = [];
const add = (name: string, level: Level, detail: string): void => {
  checks.push({ name, level, detail });
};
const present = (value: string | undefined): boolean => !!value && value.trim() !== '';

async function main(): Promise<void> {
  // 1. Which file, and what kind of environment it makes this.
  let envFile = '';
  try {
    envFile = resolveEnvFilePath();
    loadDotenv({ path: envFile });
    add('Environment file', existsSync(envFile) ? 'PASS' : 'FAIL', `${basename(envFile)} (selected by APP_ENV=${process.env.APP_ENV?.trim() || 'unset'})${existsSync(envFile) ? '' : ' — the file does not exist'}`);
  } catch (error) {
    add('Environment file', 'FAIL', error instanceof Error ? error.message : String(error));
  }
  const env = process.env as Record<string, string | undefined>;
  const appEnv = resolveAppEnvironment(env.NODE_ENV);
  const productionLike = appEnv === APP_ENVIRONMENT.PRODUCTION;
  add('Environment class', 'INFO', `NODE_ENV=${env.NODE_ENV ?? '(unset)'} is ${productionLike ? 'PRODUCTION-LIKE (strict)' : `${appEnv} (relaxed: schema sync, SQL logging and Swagger default on)`}`);

  // 2. Node.js runtime.
  const runtime = judgeNodeRuntime(process.version, new Date().toISOString().slice(0, 10), env);
  add('Node.js runtime', runtime.support.status === 'supported' ? 'PASS' : runtime.support.status === 'endOfLife' ? (productionLike ? 'FAIL' : 'WARN') : 'WARN', runtime.message ?? `${process.version} (supported)`);

  // 3. The configuration the application validates at start-up (key names only).
  try {
    validateEnv(env);
    add('Start-up validation', 'PASS', 'JWT_SECRET, database account, CORS origins and the other start-up rules are satisfied');
  } catch (error) {
    const lines = (error instanceof Error ? error.message : String(error)).split('\n').slice(1).map((line) => line.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
    for (const line of lines.length > 0 ? lines : ['the environment is not valid']) add('Start-up validation', 'FAIL', line);
  }

  // 4. Browser-facing HTTP settings.
  const origins = resolveCorsOrigins(env);
  if (origins.length === 0) {
    add('CORS origins', productionLike ? 'FAIL' : 'WARN', 'CORS_ORIGINS is empty: no web application origin may call the API' + (productionLike ? ' (nothing is allowed outside development)' : ''));
  } else {
    const malformed = origins.filter((origin) => {
      try {
        return new URL(origin).origin !== origin;
      } catch {
        return true;
      }
    });
    const insecure = origins.filter((origin) => origin.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
    if (malformed.length > 0) add('CORS origins', 'FAIL', `${malformed.length} origin(s) are not of the form scheme://host[:port] (no path): ${malformed.join(', ')}`);
    else add('CORS origins', insecure.length > 0 && productionLike ? 'WARN' : 'PASS', `${origins.length} origin(s)${insecure.length > 0 ? `; ${insecure.length} use plain http (credentials and sessions travel unencrypted)` : ''}`);
  }
  try {
    const cookie = resolveRefreshCookieSettings(env);
    add(
      'Session cookie',
      productionLike && !cookie.secure ? 'WARN' : 'PASS',
      `SameSite=${cookie.sameSite}, Secure=${cookie.secure}, path ${cookie.path}${productionLike && !cookie.secure ? ' — not Secure: enable HTTPS and set COOKIE_SECURE=true' : ''}`,
    );
  } catch (error) {
    add('Session cookie', 'FAIL', error instanceof Error ? error.message : String(error));
  }
  const rawTrust = (env.TRUST_PROXY ?? '').trim();
  if (rawTrust !== '' && !isTrustProxyValue(rawTrust)) add('Reverse proxy (TRUST_PROXY)', 'FAIL', 'TRUST_PROXY must be a hop count (1), "loopback", or a list of IP addresses / CIDR ranges — not "true"');
  else add('Reverse proxy (TRUST_PROXY)', 'INFO', resolveTrustProxy(env) === false ? 'not set: the API trusts nobody\'s X-Forwarded-For (correct when clients reach it directly; behind a reverse proxy set it, or every user shares one client address)' : `trusting ${String(resolveTrustProxy(env))}`);
  add('Swagger UI', resolveSwaggerEnabled(env) && productionLike ? 'WARN' : 'PASS', resolveSwaggerEnabled(env) ? 'enabled — it lists every route of the API' : 'disabled');

  // 5. Bootstrap leftovers.
  if (productionLike && present(env.DEFAULT_ADMIN_PASSWORD)) add('First-run administrator password', 'WARN', 'DEFAULT_ADMIN_PASSWORD is still set: once the first administrator has signed in, remove it from the environment file');

  // 6. The build that will run.
  // Run from a build (dist/scripts/ops/preflight.js) the project root is two levels up from here; run through ts-node it is the same two levels.
  const root = resolve(__dirname, '..', '..');
  const compiled = __filename.endsWith('.js');
  // From a build this file lives in dist/, so the application entry point sits beside it: dist/src/main.js. From source it is under <root>/dist.
  const mainJs = compiled ? join(root, 'src', 'main.js') : join(root, 'dist', 'src', 'main.js');
  if (existsSync(mainJs)) add('Build output', 'PASS', `dist/src/main.js present${compiled ? '' : ` (built ${statSync(mainJs).mtime.toISOString()})`}`);
  else add('Build output', compiled ? 'FAIL' : 'INFO', compiled ? 'dist/src/main.js is missing' : 'no build found (run npm run build before npm run start:prod)');

  // 7. SMTP.
  const smtp = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'].filter((key) => !present(env[key]));
  add('Mail server (environment)', smtp.length === 0 ? 'PASS' : 'INFO', smtp.length === 0 ? 'SMTP_HOST/PORT/USER/PASSWORD are set' : `not set in the environment (${smtp.join(', ')}): e-mails (invitations, password recovery) cannot be sent until a mail server is configured`);

  if (!args.has('--skip-db')) await checkDependencies(env, productionLike);

  report();
}

async function checkDependencies(env: Record<string, string | undefined>, productionLike: boolean): Promise<void> {
  // Database — the RUNTIME account, exactly as the API will connect.
  const dataSource = new DataSource({
    type: 'mysql',
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 3306),
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    charset: 'utf8mb4',
    migrations: [join(__dirname, '..', '..', 'src', 'migrations', '*{.ts,.js}')],
    synchronize: false,
    connectTimeout: 5000,
  });
  try {
    await dataSource.initialize();
    add('Database connection', 'PASS', `connected to ${env.DB_DATABASE} on ${env.DB_HOST} as ${env.DB_USERNAME}`);
    try {
      const pending = await dataSource.showMigrations();
      const migrationsRun = readBoolean(env.DB_MIGRATIONS_RUN, true);
      add('Schema migrations', pending ? (migrationsRun ? 'INFO' : 'FAIL') : 'PASS', pending ? (migrationsRun ? 'migrations are pending — the API will apply them when it starts (DB_MIGRATIONS_RUN is on)' : 'migrations are pending and DB_MIGRATIONS_RUN is off: run npm run migration:run (or migration:run:prod) before starting the API') : 'the schema is up to date');
    } catch (error) {
      add('Schema migrations', 'WARN', `could not be determined (${error instanceof Error ? error.message : String(error)})`);
    }
    try {
      const rows: Array<Record<string, string>> = await dataSource.query('SHOW GRANTS FOR CURRENT_USER()');
      const grants = rows.map((row) => Object.values(row)[0]).join('\n');
      const global = grants.split('\n').filter((line) => /ON \*\.\*/i.test(line));
      const sweeping = global.some((line) => /ALL PRIVILEGES|WITH GRANT OPTION|\bSUPER\b|\bFILE\b|\bSHUTDOWN\b/i.test(line));
      const ddl = /\b(CREATE|ALTER|DROP|INDEX)\b/i.test(grants) || /ALL PRIVILEGES/i.test(grants);
      if (sweeping) add('Database account privileges', productionLike ? 'WARN' : 'INFO', 'the runtime account holds server-wide privileges (ALL PRIVILEGES / GRANT OPTION / SUPER / FILE): use a least-privilege account (scripts/db/provision-db-users.sql)');
      else if (ddl && !readBoolean(env.DB_MIGRATIONS_RUN, true)) add('Database account privileges', 'INFO', 'the runtime account can change the schema although DB_MIGRATIONS_RUN is off: a data-only account is enough');
      else add('Database account privileges', 'PASS', 'no server-wide privileges');
    } catch {
      add('Database account privileges', 'INFO', 'could not be read');
    }
    try {
      const triggers: Array<{ TRIGGER_NAME: string }> = await dataSource.query(
        'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?',
        [env.DB_DATABASE, 'audit_logs'],
      );
      const names = new Set(triggers.map((row) => row.TRIGGER_NAME));
      const missing = [!names.has('audit_logs_no_update') && 'UPDATE', !names.has('audit_logs_no_delete') && 'DELETE'].filter((label): label is string => !!label);
      if (missing.length === 0) {
        add('Audit log immutability', 'PASS', 'audit_logs append-only triggers (audit_logs_no_update, audit_logs_no_delete) are installed');
      } else {
        add('Audit log immutability', 'FAIL', `the audit_logs append-only ${missing.join('/')} trigger is missing: audit rows can be modified or deleted — run npm run migration:run (1795700000000-AddAuditLogsAppendOnlyTrigger) with the migration account`);
      }
    } catch (error) {
      add('Audit log immutability', 'WARN', `could not be determined (${error instanceof Error ? error.message : String(error)})`);
    }
  } catch (error) {
    add('Database connection', 'FAIL', `${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }

  // Redis — optional for the application, so a failure is a warning.
  const redis = new Redis({
    host: env.REDIS_HOST || 'localhost',
    port: Number(env.REDIS_PORT || 6379),
    password: env.REDIS_PASSWORD || undefined,
    db: Number(env.REDIS_DB || 0),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectTimeout: 3000,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await redis.ping();
    add('Redis', productionLike && !present(env.REDIS_PASSWORD) ? 'WARN' : 'PASS', `${env.REDIS_HOST || 'localhost'}:${env.REDIS_PORT || 6379} answers${productionLike && !present(env.REDIS_PASSWORD) ? '; no REDIS_PASSWORD is set: Redis must not be reachable from anything but this server' : ''}`);
  } catch {
    add('Redis', 'WARN', `${env.REDIS_HOST || 'localhost'}:${env.REDIS_PORT || 6379} is not reachable: the API still runs (lock-out counters and caches fall back to the memory of one process) but sessions of several instances would not share them`);
  } finally {
    redis.disconnect();
  }
}

function report(): void {
  const strict = args.has('--strict');
  const failed = checks.some((check) => check.level === 'FAIL') || (strict && checks.some((check) => check.level === 'WARN'));
  if (args.has('--json')) {
    console.log(JSON.stringify({ ok: !failed, checks }, null, 2));
  } else {
    const width = Math.max(...checks.map((check) => check.name.length));
    for (const check of checks) console.log(`${check.level.padEnd(4)}  ${check.name.padEnd(width)}  ${check.detail}`);
    const count = (level: Level) => checks.filter((check) => check.level === level).length;
    console.log(`\n${count('PASS')} passed, ${count('WARN')} warning(s), ${count('FAIL')} failed. ${failed ? 'NOT ready.' : 'Ready.'}`);
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error('The pre-flight check itself failed:', error instanceof Error ? error.message : error);
  process.exit(2);
});
