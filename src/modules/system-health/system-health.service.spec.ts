import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';
import { HEALTH_CHECK_TIMEOUT_MS } from './system-health.constants';

// SystemHealthService against stubbed dependencies: every verdict, a hung probe, the "no connection details on the page" rule and
// the "report nothing rather than something made up" rule. No real database or Redis.
describe('SystemHealthService', () => {
  let dataSource: { query: jest.Mock };
  let redis: { ping: jest.Mock };
  let service: SystemHealthService;

  beforeEach(() => {
    dataSource = { query: jest.fn().mockResolvedValue([{ version: '8.0.36' }]) };
    redis = { ping: jest.fn().mockResolvedValue(undefined) };
    service = new SystemHealthService(dataSource as never, redis as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reports healthy with a measured latency per dependency and the database server version when everything answers', async () => {
    const health = await service.check();

    expect(health.status).toBe('healthy');
    expect(health.database).toMatchObject({ status: 'up', serverVersion: '8.0.36', error: null });
    expect(health.redis).toMatchObject({ status: 'up', error: null });
    expect(typeof health.database.latencyMs).toBe('number');
    expect(typeof health.redis.latencyMs).toBe('number');
    expect(dataSource.query).toHaveBeenCalledWith('SELECT VERSION() AS version');
    expect(redis.ping).toHaveBeenCalledTimes(1);
  });

  it('describes the API process from the running process itself', async () => {
    const { api, checkedAt } = await service.check();

    expect(api.status).toBe('up');
    expect(api.nodeVersion).toBe(process.version);
    expect(api.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(api.memory.rssBytes).toBeGreaterThan(0);
    expect(api.memory.heapUsedBytes).toBeLessThanOrEqual(api.memory.heapTotalBytes);
    // The capacity heap use is measured against: what V8 may grow to, not what it has reserved so far.
    expect(api.memory.heapLimitBytes).toBeGreaterThanOrEqual(api.memory.heapUsedBytes);
    expect(new Date(checkedAt).toString()).not.toBe('Invalid Date');
  });

  it('is UNHEALTHY when the database is unreachable — and says nothing about its version or latency', async () => {
    dataSource.query.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:3306'), { code: 'ECONNREFUSED' }));

    const health = await service.check();

    expect(health.status).toBe('unhealthy');
    expect(health.database).toEqual({ status: 'down', latencyMs: null, serverVersion: null, error: 'ECONNREFUSED' });
    expect(health.redis.status).toBe('up');
  });

  it('is DEGRADED (not unhealthy) when only Redis is down — the application keeps working without it', async () => {
    redis.ping.mockRejectedValue(Object.assign(new Error('Stream isn\'t writeable and enableOfflineQueue options is false'), {}));

    const health = await service.check();

    expect(health.status).toBe('degraded');
    expect(health.redis).toEqual({ status: 'down', latencyMs: null, error: 'Check failed' });
    expect(health.database.status).toBe('up');
  });

  it('never puts a host, port, user or message text on the page — only an error code, or a generic reason', async () => {
    dataSource.query.mockRejectedValue(new Error("Access denied for user 'root'@'10.0.0.5' (using password: YES)"));

    const { database } = await service.check();

    expect(database.error).toBe('Check failed');
    expect(JSON.stringify(database)).not.toMatch(/root|10\.0\.0\.5|password/i);
  });

  it('refuses to trust an error "code" that is not a plain upper-case identifier', async () => {
    dataSource.query.mockRejectedValue(Object.assign(new Error('x'), { code: "ER_ACCESS_DENIED' for user root" }));

    expect((await service.check()).database.error).toBe('Check failed');
  });

  it('reports a probe that never answers as down ("Timed out") after the timeout instead of hanging the request', async () => {
    jest.useFakeTimers();
    dataSource.query.mockReturnValue(new Promise(() => undefined));

    const pending = service.check();
    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS + 1);
    const health = await pending;

    expect(health.database).toEqual({ status: 'down', latencyMs: null, serverVersion: null, error: 'Timed out' });
    expect(health.redis.status).toBe('up');
    expect(health.status).toBe('unhealthy');
  });

  it('has no load average on Windows (Node reports 0/0/0 there, which would read as idle), and a real one elsewhere', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor;
    const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { ...original, value });
    try {
      setPlatform('win32');
      expect((await service.check()).server.loadAverage).toBeNull();

      setPlatform('linux');
      const linux = (await service.check()).server;
      expect(linux.loadAverage).toHaveLength(3);
      expect(linux.platform).toBe('linux');
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
  });

  it('reports host figures from the operating system, with a null disk when the platform cannot say', async () => {
    const { server } = await service.check();

    expect(server.cpuCount).toBeGreaterThan(0);
    expect(server.totalMemoryBytes).toBeGreaterThan(0);
    expect(server.freeMemoryBytes).toBeLessThanOrEqual(server.totalMemoryBytes);
    expect(server.disk === null || server.disk.totalBytes >= server.disk.freeBytes).toBe(true);
  });

  it('summary() is the same verdict in compact form and never reads host figures', async () => {
    redis.ping.mockRejectedValue(new Error('down'));

    const summary = await service.summary();

    expect(summary).toMatchObject({ status: 'degraded', api: 'up', database: 'up', redis: 'down' });
    expect(Object.keys(summary).sort()).toEqual(['api', 'checkedAt', 'database', 'redis', 'status']);
  });
});

describe('SystemHealthController access', () => {
  const guard = new RolesGuard(new Reflector());
  const contextFor = (user: unknown) =>
    ({
      getHandler: () => SystemHealthController.prototype.getHealth,
      getClass: () => SystemHealthController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('admits a SUPER_ADMIN session', () => {
    expect(guard.canActivate(contextFor({ type: 'staff', roleName: 'SUPER_ADMIN', roleNames: ['SUPER_ADMIN'] }))).toBe(true);
  });

  it('refuses every other staff role, whatever permissions it holds', () => {
    expect(guard.canActivate(contextFor({ type: 'staff', roleName: 'OPERATIONS', roleNames: ['OPERATIONS'] }))).toBe(false);
    expect(guard.canActivate(contextFor({ type: 'staff', roleName: 'ADMIN', roleNames: ['ADMIN', 'FINANCE'] }))).toBe(false);
  });

  it('refuses a customer session and an anonymous request', () => {
    expect(guard.canActivate(contextFor({ type: 'customer', sub: 9 }))).toBe(false);
    expect(guard.canActivate(contextFor(undefined))).toBe(false);
  });
});
