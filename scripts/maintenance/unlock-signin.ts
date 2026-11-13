/**
 * Lifts a sign-in lock-out from the SERVER — for the case where nobody can sign in to lift it from the application (the Manage sign-in access screen's
 * "Unlock sign-in" needs a signed-in administrator). Run by the person who owns the installation; it needs the environment file of the API (Redis
 * host and, for the audit row, the database credentials). It never touches a password or an account: it only deletes the failed-attempt COUNTERS the
 * application keeps in Redis (see src/auth/login-attempts.service.ts).
 *
 * DRY RUN BY DEFAULT — it only reports what it found. Nothing is deleted without --apply.
 *
 *   cd "CCB API"
 *   APP_ENV=<env>   (unset = .env; see src/config/env-file.ts)  \
 *   npm run maintenance:unlock-signin -- --email admin@customer.example           # what is counted for this account (dry run)
 *   npm run maintenance:unlock-signin -- --email admin@customer.example --apply   # clear it
 *   npm run maintenance:unlock-signin -- --ip 203.0.113.9 --apply                 # clear a locked client address
 *   (on a server without the dev dependencies: npm run maintenance:unlock-signin:prod -- --email … --apply)
 *
 * Limits of what it can reach: when Redis is not running (or not configured), the API keeps the counters in the memory of its own process — nothing
 * outside that process can clear them, but they are gone when the API is restarted, and they expire by themselves after LOGIN_LOCK_MINUTES (15).
 */
import Redis from 'ioredis';
import { AppDataSource } from '../../src/config/data-source';
import { LOCKOUT_SCOPES, lockoutIpKey, lockoutKeys } from '../../src/auth/login-attempts.service';
import { AuditLog } from '../../src/audit/entities/audit-log.entity';
import { AUDIT_MODULE, SECURITY_EVENT } from '../../src/audit/audit.constants';

interface Args {
  apply: boolean;
  email: string;
  ip: string;
}

function parseArgs(argv: string[]): Args {
  const read = (flag: string): string => {
    const at = argv.indexOf(flag);
    return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1].trim() : '';
  };
  return { apply: argv.includes('--apply'), email: read('--email'), ip: read('--ip') };
}

async function findKeys(redis: Redis, match: string): Promise<string[]> {
  const found: string[] = [];
  const stream = redis.scanStream({ match: `${match}*`, count: 200 });
  for await (const keys of stream as AsyncIterable<string[]>) found.push(...keys);
  return found;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email && !args.ip) {
    console.error('Give --email <address> (an account) and/or --ip <address> (a client), and --apply to clear it.');
    process.exitCode = 1;
    return;
  }
  if (args.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
    console.error('--email must be the e-mail address of the account.');
    process.exitCode = 1;
    return;
  }

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectTimeout: 3000,
  });
  redis.on('error', () => undefined);

  try {
    await redis.connect();
  } catch {
    console.log(
      `Redis (${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}) is not reachable, so the API is keeping the sign-in counters in the memory of its own process. ` +
        'Nothing outside that process can clear them: restart the API (they are gone with it), or wait for the window (LOGIN_LOCK_MINUTES, default 15) to end.',
    );
    redis.disconnect();
    process.exitCode = 1;
    return;
  }

  try {
    const targets: Array<{ label: string; keys: string[] }> = [];
    if (args.email) {
      for (const scope of LOCKOUT_SCOPES) {
        const { account, pairPrefix } = lockoutKeys(args.email, scope);
        const keys = [...new Set([...(await redis.exists(account) ? [account] : []), ...(await findKeys(redis, pairPrefix))])];
        if (keys.length > 0) targets.push({ label: `${scope} counters of ${args.email}`, keys });
      }
    }
    if (args.ip) {
      for (const scope of LOCKOUT_SCOPES) {
        const key = lockoutIpKey(args.ip, scope);
        if (await redis.exists(key)) targets.push({ label: `${scope} counter of client ${args.ip}`, keys: [key] });
      }
    }

    const total = targets.reduce((sum, target) => sum + target.keys.length, 0);
    if (total === 0) {
      console.log('Nothing is counted against that account / client: it is not locked by the application (check the e-mail address and the Redis database in use).');
      return;
    }
    for (const target of targets) console.log(`  ${target.label}: ${target.keys.length} counter(s)`);
    if (!args.apply) {
      console.log(`\nDRY RUN — nothing was changed. Add --apply to clear these ${total} counter(s).`);
      return;
    }

    for (const target of targets) await redis.del(...target.keys);
    console.log(`\nDone. ${total} counter(s) cleared: sign-in works again immediately.`);

    // The audit row is best effort — the point of this tool is to get an administrator back in, even when the database is not reachable from here.
    try {
      await AppDataSource.initialize();
      const audit = AppDataSource.getRepository(AuditLog);
      await audit.save(
        audit.create({
          moduleName: AUDIT_MODULE.SECURITY,
          entityId: null,
          action: SECURITY_EVENT.SIGNIN_UNLOCKED,
          oldValue: null,
          newValue: JSON.stringify({ countersCleared: total, scope: args.email ? 'account' : 'client', via: 'server maintenance tool' }),
          performedBy: null,
        }),
      );
      console.log('An audit entry was written (security > SIGNIN_UNLOCKED).');
    } catch {
      console.log('The audit entry could not be written (the database is not reachable from here) — the counters were cleared all the same.');
    } finally {
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
    }
  } finally {
    redis.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
