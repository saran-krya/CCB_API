import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IsNull, MoreThanOrEqual } from 'typeorm';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DashboardController } from './dashboard.controller';
import { PlatformUserStats } from './dto/platform-dashboard-response.dto';
import { buildPlatformAlerts } from './platform-alerts';
import { SystemHealthSummary } from '../system-health/dto/system-health-response.dto';
import {
  DASHBOARD_RECENT_ACTIVITY_COUNT,
  PlatformDashboardService,
  RECENT_SIGN_IN_WINDOW_DAYS,
} from './platform-dashboard.service';

// PlatformDashboardService against stubbed repositories: every figure must come from a count over the live tables (or the live
// audit/health services) — never a constant.
describe('PlatformDashboardService', () => {
  const NOW = new Date('2026-11-10T06:00:00.000Z');

  let users: { count: jest.Mock };
  let userRoles: { createQueryBuilder: jest.Mock };
  let refreshTokens: { createQueryBuilder: jest.Mock };
  let roles: { count: jest.Mock };
  let policies: { count: jest.Mock };
  let modules: { count: jest.Mock };
  let auditLogs: { recent: jest.Mock };
  let health: { summary: jest.Mock };
  let service: PlatformDashboardService;
  let superAdminQb: { innerJoin: jest.Mock; getCount: jest.Mock };
  let sessionQb: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);

    // users.count answers by the `where` it is given, like the real table would.
    users = {
      count: jest.fn(async (options?: { where?: Record<string, unknown> }) => {
        const where = options?.where as { active?: boolean; mustChangePassword?: boolean; lastLoginAt?: { _type?: string } } | undefined;
        if (!where) return 12;
        if (where.mustChangePassword === true) return 2;
        if (where.lastLoginAt?._type === 'moreThanOrEqual') return 7;
        if (where.lastLoginAt?._type === 'isNull') return 3;
        if (where.active === true) return 10;
        return -1;
      }),
    };
    superAdminQb = { innerJoin: jest.fn().mockReturnThis(), getCount: jest.fn().mockResolvedValue(2) };
    userRoles = { createQueryBuilder: jest.fn().mockReturnValue(superAdminQb) };
    sessionQb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ sessions: '4' }),
    };
    refreshTokens = { createQueryBuilder: jest.fn().mockReturnValue(sessionQb) };
    roles = { count: jest.fn().mockResolvedValue(9) };
    policies = { count: jest.fn().mockResolvedValue(6) };
    modules = { count: jest.fn(async (options?: { where?: { isActive?: boolean } }) => (options?.where?.isActive ? 8 : 10)) };
    auditLogs = { recent: jest.fn().mockResolvedValue([{ id: 99, action: 'UPDATE' }]) };
    health = { summary: jest.fn().mockResolvedValue({ status: 'degraded', checkedAt: NOW.toISOString(), api: 'up', database: 'up', redis: 'down' }) };

    service = new PlatformDashboardService(
      users as never,
      userRoles as never,
      refreshTokens as never,
      roles as never,
      policies as never,
      modules as never,
      auditLogs as never,
      health as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('builds every section from live counts', async () => {
    const dashboard = await service.getPlatform();

    expect(dashboard.generatedAt).toBe(NOW.toISOString());
    expect(dashboard.users).toEqual({
      total: 12,
      active: 10,
      inactive: 2, // total - active, never a separate guess
      activeSuperAdmins: 2,
      mustChangePassword: 2,
      signedInRecently: 7,
      signedInWindowDays: RECENT_SIGN_IN_WINDOW_DAYS,
      neverSignedIn: 3,
    });
    expect(dashboard.access).toEqual({ roles: 9, policies: 6, activeStaffSessions: 4 });
    expect(dashboard.modules).toEqual({ total: 10, active: 8 });
    expect(dashboard.recentActivity).toEqual([{ id: 99, action: 'UPDATE' }]);
    expect(dashboard.health).toMatchObject({ status: 'degraded', redis: 'down' });
    // Redis is down in this fixture, 2 accounts must change their password and 3 never signed in; 2 SUPER_ADMINs is healthy.
    expect(dashboard.alerts).toEqual([
      { code: 'REDIS_DOWN', severity: 'warning', count: null },
      { code: 'PASSWORD_CHANGE_PENDING', severity: 'info', count: 2 },
      { code: 'NEVER_SIGNED_IN', severity: 'info', count: 3 },
    ]);
  });

  it('counts "signed in recently" from a date exactly the window ago, and "never signed in" as active accounts with no login', async () => {
    await service.getPlatform();

    const wheres = users.count.mock.calls.map(([options]) => options?.where).filter(Boolean);
    const since = new Date(NOW.getTime() - RECENT_SIGN_IN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    expect(wheres).toContainEqual({ active: true, lastLoginAt: MoreThanOrEqual(since) });
    expect(wheres).toContainEqual({ active: true, lastLoginAt: IsNull() });
    expect(wheres).toContainEqual({ active: true, mustChangePassword: true });
  });

  it('counts SUPER_ADMIN holders among ACTIVE, non-deleted users only', async () => {
    await service.getPlatform();

    const joins = superAdminQb.innerJoin.mock.calls;
    expect(joins[0][0]).toBe('ur.user');
    expect(joins[0][2]).toContain('user.active = :active');
    expect(joins[0][2]).toContain('user.deletedAt IS NULL');
    expect(joins[1][3]).toEqual({ roleName: 'SUPER_ADMIN' });
  });

  it('counts sessions as distinct refresh-token families that are staff, unrevoked and unexpired', async () => {
    await service.getPlatform();

    expect(sessionQb.select).toHaveBeenCalledWith('COUNT(DISTINCT rt.family)', 'sessions');
    expect(sessionQb.where).toHaveBeenCalledWith('rt.principalType = :principalType', { principalType: 'staff' });
    expect(sessionQb.andWhere).toHaveBeenCalledWith('rt.revokedAt IS NULL');
    expect(sessionQb.andWhere).toHaveBeenCalledWith('rt.expiresAt > :now', { now: NOW });
  });

  it('shows zero sessions when none are live (an empty aggregate row, not an error)', async () => {
    sessionQb.getRawOne.mockResolvedValue(undefined);

    expect((await service.getPlatform()).access.activeStaffSessions).toBe(0);
  });

  it('asks the audit trail for the newest entries only', async () => {
    await service.getPlatform();

    expect(auditLogs.recent).toHaveBeenCalledWith(DASHBOARD_RECENT_ACTIVITY_COUNT);
  });
});

describe('buildPlatformAlerts', () => {
  const users = (overrides: Partial<PlatformUserStats> = {}): PlatformUserStats => ({
    total: 10,
    active: 10,
    inactive: 0,
    activeSuperAdmins: 2,
    mustChangePassword: 0,
    signedInRecently: 10,
    signedInWindowDays: 30,
    neverSignedIn: 0,
    ...overrides,
  });
  const health = (overrides: Partial<SystemHealthSummary> = {}): SystemHealthSummary => ({
    status: 'healthy',
    checkedAt: '2026-11-10T06:00:00.000Z',
    api: 'up',
    database: 'up',
    redis: 'up',
    ...overrides,
  });

  it('reports nothing when everything is fine', () => {
    expect(buildPlatformAlerts(users(), health())).toEqual([]);
  });

  it('a database that is down is critical, Redis only a warning', () => {
    expect(buildPlatformAlerts(users(), health({ database: 'down', status: 'unhealthy' }))).toEqual([
      { code: 'DATABASE_DOWN', severity: 'critical', count: null },
    ]);
    expect(buildPlatformAlerts(users(), health({ redis: 'down', status: 'degraded' }))).toEqual([
      { code: 'REDIS_DOWN', severity: 'warning', count: null },
    ]);
  });

  it('protects administrator access: no active SUPER_ADMIN is critical, exactly one is a warning, two or more is fine', () => {
    expect(buildPlatformAlerts(users({ activeSuperAdmins: 0 }), health())).toEqual([
      { code: 'NO_ACTIVE_SUPER_ADMIN', severity: 'critical', count: null },
    ]);
    expect(buildPlatformAlerts(users({ activeSuperAdmins: 1 }), health())).toEqual([
      { code: 'SINGLE_ACTIVE_SUPER_ADMIN', severity: 'warning', count: 1 },
    ]);
    expect(buildPlatformAlerts(users({ activeSuperAdmins: 2 }), health())).toEqual([]);
  });

  it('counts the accounts that still have to set a password or never signed in, and only when there are some', () => {
    expect(buildPlatformAlerts(users({ mustChangePassword: 4, neverSignedIn: 1 }), health())).toEqual([
      { code: 'PASSWORD_CHANGE_PENDING', severity: 'info', count: 4 },
      { code: 'NEVER_SIGNED_IN', severity: 'info', count: 1 },
    ]);
  });

  it('lists the most severe first however the conditions arise', () => {
    const alerts = buildPlatformAlerts(
      users({ activeSuperAdmins: 0, mustChangePassword: 1 }),
      health({ database: 'down', redis: 'down', status: 'unhealthy' }),
    );

    expect(alerts.map((alert) => alert.severity)).toEqual(['critical', 'critical', 'warning', 'info']);
    expect(alerts.map((alert) => alert.code)).toEqual(['DATABASE_DOWN', 'NO_ACTIVE_SUPER_ADMIN', 'REDIS_DOWN', 'PASSWORD_CHANGE_PENDING']);
  });
});

describe('DashboardController access', () => {
  const guard = new RolesGuard(new Reflector());
  const contextFor = (handler: keyof DashboardController, user: unknown) =>
    ({
      getHandler: () => DashboardController.prototype[handler],
      getClass: () => DashboardController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const superAdmin = { type: 'staff', roleName: 'SUPER_ADMIN', roleNames: ['SUPER_ADMIN'] };
  const operations = { type: 'staff', roleName: 'OPERATIONS', roleNames: ['OPERATIONS'] };

  it('the platform section is SUPER_ADMIN-only: other staff, customers and anonymous requests are refused', () => {
    expect(guard.canActivate(contextFor('getPlatform', superAdmin))).toBe(true);
    expect(guard.canActivate(contextFor('getPlatform', operations))).toBe(false);
    expect(guard.canActivate(contextFor('getPlatform', { type: 'customer', sub: 1 }))).toBe(false);
    expect(guard.canActivate(contextFor('getPlatform', undefined))).toBe(false);
  });

  it('the existing business dashboard routes are untouched: no @Roles, so any authenticated staff session still reaches them', () => {
    for (const handler of ['getStats', 'getUnitOccupancy', 'getConsumption', 'getBillingPipeline'] as const) {
      expect(guard.canActivate(contextFor(handler, operations))).toBe(true);
    }
  });
});
