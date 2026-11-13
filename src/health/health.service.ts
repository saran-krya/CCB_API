import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from '../redis/redis.service';

export type ReadinessStatus = 'ok' | 'degraded' | 'unavailable';
export type DependencyState = 'up' | 'down';

export interface ReadinessBody {
  status: ReadinessStatus;
  /** Why the instance is unavailable (absent when it is available). `shutting-down`: the instance is healthy but must not receive new traffic. */
  reason?: 'shutting-down' | 'database-down' | 'migrations-pending';
  /** What was measured. Absent while shutting down: nothing is probed then, and a check that was not made is not reported. */
  checks?: { database: DependencyState; redis: DependencyState; migrations: 'current' | 'pending' | 'unknown' };
}

export interface ReadinessReport {
  httpStatus: 200 | 503;
  body: ReadinessBody;
}

/** How long one probe may take before its dependency counts as down. */
export const HEALTH_PROBE_TIMEOUT_MS = 1500;
/** A readiness answer is reused this long, so a monitor polling every second (or several of them) costs the database one query, not one each. */
export const HEALTH_CACHE_MS = 2000;
/** The (costlier) pending-migrations question is asked at most this often. */
export const HEALTH_MIGRATION_CACHE_MS = 60_000;

const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const readBoolean = (value: string | undefined): boolean => ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
const readMs = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * The two questions an orchestrator, load balancer or uptime monitor asks, answered WITHOUT authentication (a probe has no account) and WITHOUT
 * detail (no versions, hosts, errors or counts — the signed-in System Health screen has those):
 *
 *   live  — "is the process running?" Never touches a dependency: a database outage must not make a supervisor restart a healthy process.
 *   ready — "should this instance receive traffic?" The database answers, the schema is current (no migration pending), and the process is not
 *           shutting down. Redis is optional here (the application is built to run without it): a Redis outage reads "degraded", still HTTP 200.
 *
 * It also owns the graceful-shutdown order (BeforeApplicationShutdown): on SIGTERM readiness flips to 503 first, so a load balancer stops routing to
 * the instance, then the application closes (HTTP server, scheduled jobs, database pool, Redis) through Nest's own shutdown hooks.
 */
@Injectable()
export class HealthService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(HealthService.name);
  private shuttingDown = false;
  private cached: { at: number; report: ReadinessReport } | null = null;
  private migrations: { at: number; state: 'current' | 'pending' | 'unknown' } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async ready(): Promise<ReadinessReport> {
    if (this.shuttingDown) {
      return { httpStatus: 503, body: { status: 'unavailable', reason: 'shutting-down' } };
    }
    const now = Date.now();
    if (this.cached && now - this.cached.at < HEALTH_CACHE_MS) return this.cached.report;

    const [database, redis, migrations] = await Promise.all([this.probeDatabase(), this.probeRedis(), this.probeMigrations()]);
    const ignorePending = readBoolean(process.env.HEALTH_IGNORE_PENDING_MIGRATIONS);

    let report: ReadinessReport;
    if (database === 'down') {
      report = { httpStatus: 503, body: { status: 'unavailable', reason: 'database-down', checks: { database, redis, migrations } } };
    } else if (migrations === 'pending' && !ignorePending) {
      report = { httpStatus: 503, body: { status: 'unavailable', reason: 'migrations-pending', checks: { database, redis, migrations } } };
    } else {
      report = { httpStatus: 200, body: { status: redis === 'down' ? 'degraded' : 'ok', checks: { database, redis, migrations } } };
    }
    this.cached = { at: now, report };
    return report;
  }

  /** Nest calls this on SIGTERM / SIGINT (enableShutdownHooks in main.ts), BEFORE it closes anything. */
  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.shuttingDown = true;
    this.logger.log(`Shutting down${signal ? ` (${signal})` : ''}: readiness now answers 503 so no new traffic is routed here.`);

    // A load balancer needs a moment to notice; with none in front there is nothing to wait for (the default).
    const drainMs = readMs(process.env.SHUTDOWN_DRAIN_MS, 0);
    if (drainMs > 0) await new Promise((resolve) => setTimeout(resolve, drainMs));

    // A close that hangs (a request that never ends, a database that does not answer) must not keep the process alive for ever.
    const timeoutMs = readMs(process.env.SHUTDOWN_TIMEOUT_MS, 15_000);
    if (timeoutMs > 0) {
      setTimeout(() => {
        this.logger.error(`Graceful shutdown did not finish within ${timeoutMs} ms: exiting.`);
        process.exit(1);
      }, timeoutMs).unref();
    }
  }

  private async probeDatabase(): Promise<DependencyState> {
    try {
      await withTimeout(this.dataSource.query('SELECT 1'), HEALTH_PROBE_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async probeRedis(): Promise<DependencyState> {
    try {
      await withTimeout(this.redis.ping(), HEALTH_PROBE_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async probeMigrations(): Promise<'current' | 'pending' | 'unknown'> {
    const now = Date.now();
    if (this.migrations && now - this.migrations.at < HEALTH_MIGRATION_CACHE_MS) return this.migrations.state;
    let state: 'current' | 'pending' | 'unknown';
    try {
      state = (await withTimeout(this.dataSource.showMigrations(), HEALTH_PROBE_TIMEOUT_MS)) ? 'pending' : 'current';
    } catch {
      // Cannot tell (database down, slow): never reported as "pending" on a guess; the database probe has its own verdict.
      state = 'unknown';
    }
    // An "unknown" answer is not remembered, so the next probe asks again.
    if (state !== 'unknown') this.migrations = { at: now, state };
    return state;
  }
}
