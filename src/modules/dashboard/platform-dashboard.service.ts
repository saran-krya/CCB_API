import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLogQueryService } from '../../audit/audit-log-query.service';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { PRINCIPAL_TYPE } from '../../common/constants/auth.constants';
import { ROLES } from '../../common/constants/global';
import { Policy } from '../iam/entities/policy.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';
import { Role } from '../role/entities/role.entity';
import { SystemHealthService } from '../system-health/system-health.service';
import { User } from '../user/entities/user.entity';
import { UserRole } from '../user-role/entities/user-role.entity';
import { PlatformDashboardResponse, PlatformUserStats } from './dto/platform-dashboard-response.dto';
import { buildPlatformAlerts } from './platform-alerts';

/** "Signed in recently" means within this many days. */
export const RECENT_SIGN_IN_WINDOW_DAYS = 30;

/** Recent audit entries shown on the dashboard. */
export const DASHBOARD_RECENT_ACTIVITY_COUNT = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The SUPER_ADMIN dashboard section: internal-user statistics, access configuration, the module catalog, the latest audit
 * entries and system health. Read-only and uncached — each figure is a count over the live tables (or a live health probe)
 * taken when the dashboard is opened, so nothing on it is hardcoded or stale.
 */
@Injectable()
export class PlatformDashboardService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Policy) private readonly policies: Repository<Policy>,
    @InjectRepository(PModule) private readonly modules: Repository<PModule>,
    private readonly auditLogs: AuditLogQueryService,
    private readonly health: SystemHealthService,
  ) {}

  async getPlatform(): Promise<PlatformDashboardResponse> {
    const now = new Date();
    const since = new Date(now.getTime() - RECENT_SIGN_IN_WINDOW_DAYS * DAY_MS);

    const [
      totalUsers,
      activeUsers,
      activeSuperAdmins,
      mustChangePassword,
      signedInRecently,
      neverSignedIn,
      roles,
      policies,
      activeStaffSessions,
      totalModules,
      activeModules,
      recentActivity,
      health,
    ] = await Promise.all([
      this.users.count(),
      this.users.count({ where: { active: true } }),
      this.countActiveSuperAdmins(),
      this.users.count({ where: { active: true, mustChangePassword: true } }),
      this.users.count({ where: { active: true, lastLoginAt: MoreThanOrEqual(since) } }),
      this.users.count({ where: { active: true, lastLoginAt: IsNull() } }),
      this.roles.count(),
      this.policies.count(),
      this.countActiveStaffSessions(now),
      this.modules.count(),
      this.modules.count({ where: { isActive: true } }),
      this.auditLogs.recent(DASHBOARD_RECENT_ACTIVITY_COUNT),
      this.health.summary(),
    ]);

    const userStats: PlatformUserStats = {
      total: totalUsers,
      active: activeUsers,
      inactive: totalUsers - activeUsers,
      activeSuperAdmins,
      mustChangePassword,
      signedInRecently,
      signedInWindowDays: RECENT_SIGN_IN_WINDOW_DAYS,
      neverSignedIn,
    };

    return {
      generatedAt: now.toISOString(),
      users: userStats,
      access: { roles, policies, activeStaffSessions },
      modules: { total: totalModules, active: activeModules },
      alerts: buildPlatformAlerts(userStats, health),
      recentActivity,
      health,
    };
  }

  private countActiveSuperAdmins(): Promise<number> {
    return this.userRoles
      .createQueryBuilder('ur')
      .innerJoin('ur.user', 'user', 'user.active = :active AND user.deletedAt IS NULL', { active: true })
      .innerJoin('ur.role', 'role', 'role.roleName = :roleName', { roleName: ROLES.SUPER_ADMIN })
      .getCount();
  }

  /** Distinct sessions, not tokens: one session is a refresh-token family that keeps one live token across rotations. */
  private async countActiveStaffSessions(now: Date): Promise<number> {
    const row = await this.refreshTokens
      .createQueryBuilder('rt')
      .select('COUNT(DISTINCT rt.family)', 'sessions')
      .where('rt.principalType = :principalType', { principalType: PRINCIPAL_TYPE.STAFF })
      .andWhere('rt.revokedAt IS NULL')
      .andWhere('rt.expiresAt > :now', { now })
      .getRawOne<{ sessions: string | number }>();
    return Number(row?.sessions ?? 0);
  }
}
