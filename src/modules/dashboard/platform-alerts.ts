import { SystemHealthSummary } from '../system-health/dto/system-health-response.dto';
import { COMPONENT_STATUS } from '../system-health/system-health.constants';
import { PlatformAlert, PlatformUserStats } from './dto/platform-dashboard-response.dto';

/** The conditions the SUPER_ADMIN dashboard calls out. The frontend only maps a code to its wording. */
export const PLATFORM_ALERT_CODE = {
  DATABASE_DOWN: 'DATABASE_DOWN',
  REDIS_DOWN: 'REDIS_DOWN',
  NO_ACTIVE_SUPER_ADMIN: 'NO_ACTIVE_SUPER_ADMIN',
  SINGLE_ACTIVE_SUPER_ADMIN: 'SINGLE_ACTIVE_SUPER_ADMIN',
  PASSWORD_CHANGE_PENDING: 'PASSWORD_CHANGE_PENDING',
  NEVER_SIGNED_IN: 'NEVER_SIGNED_IN',
} as const;

export const ALERT_SEVERITY = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
} as const;

const SEVERITY_ORDER = [ALERT_SEVERITY.CRITICAL, ALERT_SEVERITY.WARNING, ALERT_SEVERITY.INFO];

/**
 * What needs the platform administrator's attention right now, from the figures the dashboard already holds:
 *  - the database / Redis being down (critical / warning — see SystemHealthService for why Redis is only a warning);
 *  - the administrator safety net: with no active SUPER_ADMIN nobody can manage the platform (critical), with exactly one a single
 *    lock-out loses it (warning) — the same "at least one must always remain" rule the user-management guards enforce;
 *  - housekeeping: active accounts that still have to set a password, or that never signed in (informational, with a count).
 * Most severe first; empty when there is nothing to report.
 */
export function buildPlatformAlerts(users: PlatformUserStats, health: SystemHealthSummary): PlatformAlert[] {
  const alerts: PlatformAlert[] = [];

  if (health.database === COMPONENT_STATUS.DOWN) {
    alerts.push({ code: PLATFORM_ALERT_CODE.DATABASE_DOWN, severity: ALERT_SEVERITY.CRITICAL, count: null });
  }
  if (health.redis === COMPONENT_STATUS.DOWN) {
    alerts.push({ code: PLATFORM_ALERT_CODE.REDIS_DOWN, severity: ALERT_SEVERITY.WARNING, count: null });
  }
  if (users.activeSuperAdmins === 0) {
    alerts.push({ code: PLATFORM_ALERT_CODE.NO_ACTIVE_SUPER_ADMIN, severity: ALERT_SEVERITY.CRITICAL, count: null });
  } else if (users.activeSuperAdmins === 1) {
    alerts.push({ code: PLATFORM_ALERT_CODE.SINGLE_ACTIVE_SUPER_ADMIN, severity: ALERT_SEVERITY.WARNING, count: 1 });
  }
  if (users.mustChangePassword > 0) {
    alerts.push({ code: PLATFORM_ALERT_CODE.PASSWORD_CHANGE_PENDING, severity: ALERT_SEVERITY.INFO, count: users.mustChangePassword });
  }
  if (users.neverSignedIn > 0) {
    alerts.push({ code: PLATFORM_ALERT_CODE.NEVER_SIGNED_IN, severity: ALERT_SEVERITY.INFO, count: users.neverSignedIn });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}
