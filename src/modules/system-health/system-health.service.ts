import { Injectable, Logger } from '@nestjs/common';
import { statfs } from 'fs/promises';
import * as os from 'os';
import { performance } from 'perf_hooks';
import { getHeapStatistics } from 'v8';
import { DataSource } from 'typeorm';
import { resolveAppEnvironment } from '../../config/runtime-config';
import { RedisService } from '../../redis/redis.service';
import {
  ApiRuntimeHealth,
  DatabaseHealth,
  DependencyHealth,
  ServerHealth,
  SystemHealthResponse,
  SystemHealthSummary,
} from './dto/system-health-response.dto';
import {
  CHECK_TIMED_OUT,
  COMPONENT_STATUS,
  GENERIC_CHECK_FAILURE,
  HEALTH_CHECK_TIMEOUT_MS,
  OVERALL_STATUS,
  OverallStatus,
} from './system-health.constants';

class ProbeTimeoutError extends Error {
  constructor() {
    super(CHECK_TIMED_OUT);
  }
}

const roundMs = (ms: number): number => Math.round(ms * 10) / 10;

/**
 * Real health of the running application: the API process itself, the database and Redis. Every number is measured at
 * request time — a probe's latency is the real round trip, memory/uptime come from the process, host figures from the operating
 * system — and a fact the platform cannot report is `null`, never a placeholder. Read-only: the probes are `SELECT VERSION()`
 * and `PING`; nothing is written anywhere.
 */
@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<SystemHealthResponse> {
    const [{ database, redis }, disk] = await Promise.all([this.probeDependencies(), this.readDisk()]);
    return {
      status: this.overallStatus(database, redis),
      checkedAt: new Date().toISOString(),
      api: this.readApiRuntime(),
      database,
      redis,
      server: this.readServer(disk),
    };
  }

  /** Verdict + each dependency's status only (no host figures) — what the dashboard embeds. */
  async summary(): Promise<SystemHealthSummary> {
    const { database, redis } = await this.probeDependencies();
    return {
      status: this.overallStatus(database, redis),
      checkedAt: new Date().toISOString(),
      api: COMPONENT_STATUS.UP,
      database: database.status,
      redis: redis.status,
    };
  }

  private async probeDependencies(): Promise<{ database: DatabaseHealth; redis: DependencyHealth }> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    return { database, redis };
  }

  private overallStatus(database: DependencyHealth, redis: DependencyHealth): OverallStatus {
    if (database.status === COMPONENT_STATUS.DOWN) return OVERALL_STATUS.UNHEALTHY;
    if (redis.status === COMPONENT_STATUS.DOWN) return OVERALL_STATUS.DEGRADED;
    return OVERALL_STATUS.HEALTHY;
  }

  private async checkDatabase(): Promise<DatabaseHealth> {
    try {
      const { value: rows, latencyMs } = await this.timed(() =>
        this.dataSource.query('SELECT VERSION() AS version') as Promise<Array<{ version?: unknown }>>,
      );
      const version = rows?.[0]?.version;
      return {
        status: COMPONENT_STATUS.UP,
        latencyMs,
        serverVersion: typeof version === 'string' ? version : null,
        error: null,
      };
    } catch (err) {
      return { status: COMPONENT_STATUS.DOWN, latencyMs: null, serverVersion: null, error: this.describeFailure('Database', err) };
    }
  }

  private async checkRedis(): Promise<DependencyHealth> {
    try {
      const { latencyMs } = await this.timed(() => this.redis.ping());
      return { status: COMPONENT_STATUS.UP, latencyMs, error: null };
    } catch (err) {
      return { status: COMPONENT_STATUS.DOWN, latencyMs: null, error: this.describeFailure('Redis', err) };
    }
  }

  /** Runs one probe, failing it with a timeout error when it does not answer in HEALTH_CHECK_TIMEOUT_MS. */
  private async timed<T>(probe: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      const value = await Promise.race([
        probe(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ProbeTimeoutError()), HEALTH_CHECK_TIMEOUT_MS);
        }),
      ]);
      return { value, latencyMs: roundMs(performance.now() - started) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** A short, safe reason for the page. The full error goes to the server log only — a driver message can carry a host,
   *  port or user, which the page must not show. */
  private describeFailure(component: string, err: unknown): string {
    this.logger.warn(`${component} health probe failed: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof ProbeTimeoutError) return CHECK_TIMED_OUT;
    const code = (err as { code?: unknown })?.code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : GENERIC_CHECK_FAILURE;
  }

  private readApiRuntime(): ApiRuntimeHealth {
    const memory = process.memoryUsage();
    return {
      status: COMPONENT_STATUS.UP,
      environment: resolveAppEnvironment(process.env.NODE_ENV),
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        heapLimitBytes: getHeapStatistics().heap_size_limit,
      },
    };
  }

  private readServer(disk: ServerHealth['disk']): ServerHealth {
    const [one, five, fifteen] = os.loadavg();
    return {
      platform: process.platform,
      osUptimeSeconds: Math.floor(os.uptime()),
      cpuCount: os.cpus().length,
      // Windows has no load average: Node reports 0/0/0 there, which would read as "idle" — so say nothing instead.
      loadAverage: process.platform === 'win32' ? null : [one, five, fifteen],
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      disk,
    };
  }

  /** Capacity of the volume the API runs from, or null when the platform cannot report it. */
  private async readDisk(): Promise<ServerHealth['disk']> {
    try {
      const stats = await statfs(process.cwd());
      return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
    } catch (err) {
      this.logger.warn(`Disk capacity unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
