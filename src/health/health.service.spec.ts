import type { DataSource } from 'typeorm';
import type { RedisService } from '../redis/redis.service';
import { HEALTH_CACHE_MS, HEALTH_MIGRATION_CACHE_MS, HEALTH_PROBE_TIMEOUT_MS, HealthService } from './health.service';

type Fake<T> = { [K in keyof T]?: jest.Mock };

describe('HealthService', () => {
  let dataSource: Fake<DataSource>;
  let redis: Fake<RedisService>;
  const make = () => new HealthService(dataSource as unknown as DataSource, redis as unknown as RedisService);
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    dataSource = { query: jest.fn().mockResolvedValue([{ 1: 1 }]), showMigrations: jest.fn().mockResolvedValue(false) };
    redis = { ping: jest.fn().mockResolvedValue(undefined) };
    for (const key of ['HEALTH_IGNORE_PENDING_MIGRATIONS', 'SHUTDOWN_DRAIN_MS', 'SHUTDOWN_TIMEOUT_MS']) saved[key] = process.env[key];
  });

  afterEach(() => {
    jest.useRealTimers();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('liveness never touches a dependency', () => {
    expect(make().live()).toEqual({ status: 'ok' });
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('is ready (200, ok) when the database answers, the schema is current and Redis answers', async () => {
    const report = await make().ready();
    expect(report.httpStatus).toBe(200);
    expect(report.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up', migrations: 'current' } });
  });

  it('reads degraded — still HTTP 200 — when only Redis is down (the application runs without it)', async () => {
    redis.ping!.mockRejectedValue(new Error('ECONNREFUSED'));
    const report = await make().ready();
    expect(report.httpStatus).toBe(200);
    expect(report.body.status).toBe('degraded');
    expect(report.body.checks?.redis).toBe('down');
  });

  it('is unavailable (503) when the database is down, and says nothing about why beyond the reason code', async () => {
    dataSource.query!.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:3306 user=ccb_app'));
    const report = await make().ready();
    expect(report.httpStatus).toBe(503);
    expect(report.body).toMatchObject({ status: 'unavailable', reason: 'database-down' });
    expect(JSON.stringify(report.body)).not.toContain('10.0.0.5');
  });

  it('treats a database that does not answer in time as down', async () => {
    dataSource.query!.mockReturnValue(new Promise(() => undefined));
    const pending = make().ready();
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_TIMEOUT_MS + 10);
    const report = await pending;
    expect(report.httpStatus).toBe(503);
    expect(report.body.checks?.database).toBe('down');
  });

  it('is unavailable while a migration is pending, unless HEALTH_IGNORE_PENDING_MIGRATIONS is set', async () => {
    dataSource.showMigrations!.mockResolvedValue(true);
    const blocked = await make().ready();
    expect(blocked.httpStatus).toBe(503);
    expect(blocked.body).toMatchObject({ status: 'unavailable', reason: 'migrations-pending' });

    process.env.HEALTH_IGNORE_PENDING_MIGRATIONS = 'true';
    const ignored = await make().ready();
    expect(ignored.httpStatus).toBe(200);
  });

  it('never calls the schema "pending" on a guess: an unanswerable migration question is "unknown" and does not block', async () => {
    dataSource.showMigrations!.mockRejectedValue(new Error('boom'));
    const report = await make().ready();
    expect(report.httpStatus).toBe(200);
    expect(report.body.checks?.migrations).toBe('unknown');
  });

  it('answers repeated probes from a short cache, and asks the migration question far less often', async () => {
    const service = make();
    await service.ready();
    await service.ready();
    expect(dataSource.query).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(HEALTH_CACHE_MS + 1);
    await service.ready();
    expect(dataSource.query).toHaveBeenCalledTimes(2);
    expect(dataSource.showMigrations).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(HEALTH_MIGRATION_CACHE_MS);
    await service.ready();
    expect(dataSource.showMigrations).toHaveBeenCalledTimes(2);
  });

  it('flips readiness to 503 as soon as shutdown begins, before anything is closed', async () => {
    const service = make();
    expect((await service.ready()).httpStatus).toBe(200);

    process.env.SHUTDOWN_TIMEOUT_MS = '0';
    await service.beforeApplicationShutdown('SIGTERM');

    expect(service.isShuttingDown()).toBe(true);
    const report = await service.ready();
    expect(report.httpStatus).toBe(503);
    expect(report.body.reason).toBe('shutting-down');
    // Nothing is probed while shutting down, so nothing is reported as measured.
    expect(report.body.checks).toBeUndefined();
  });

  it('waits SHUTDOWN_DRAIN_MS so a load balancer can notice, and arms a forced exit if the close hangs', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    process.env.SHUTDOWN_DRAIN_MS = '3000';
    process.env.SHUTDOWN_TIMEOUT_MS = '5000';
    const service = make();

    let done = false;
    const shutdown = service.beforeApplicationShutdown('SIGTERM').then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(2);
    await shutdown;
    expect(done).toBe(true);

    expect(exit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5000);
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });
});
