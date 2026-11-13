import { AuditLogListItem } from '../../../audit/dto/audit-log-response.dto';
import { SystemHealthSummary } from '../../system-health/dto/system-health-response.dto';

/** Internal (staff) accounts — the `users` table; customers sign in through the portal and are not counted here. */
export interface PlatformUserStats {
  total: number;
  active: number;
  inactive: number;
  /** Active accounts currently holding the SUPER_ADMIN role — what "at least one must always remain" protects. */
  activeSuperAdmins: number;
  /** Active accounts that must set a new password at their next sign-in. */
  mustChangePassword: number;
  /** Active accounts that signed in within `signedInWindowDays`. */
  signedInRecently: number;
  signedInWindowDays: number;
  /** Active accounts that have never signed in. */
  neverSignedIn: number;
}

export interface PlatformAccessStats {
  roles: number;
  policies: number;
  /** Distinct live staff sessions (a refresh-token family with an unrevoked, unexpired token). */
  activeStaffSessions: number;
}

export interface PlatformModuleStats {
  total: number;
  active: number;
}

export type PlatformAlertSeverity = 'critical' | 'warning' | 'info';

/** One thing that needs attention. `code` identifies the condition (the frontend owns the wording); `count` is how many
 *  accounts/items it concerns, `null` when the condition has no count. */
export interface PlatformAlert {
  code: string;
  severity: PlatformAlertSeverity;
  count: number | null;
}

/** Everything the SUPER_ADMIN dashboard section shows — every figure is counted from the live tables at request time. */
export interface PlatformDashboardResponse {
  generatedAt: string;
  users: PlatformUserStats;
  access: PlatformAccessStats;
  modules: PlatformModuleStats;
  alerts: PlatformAlert[];
  recentActivity: AuditLogListItem[];
  health: SystemHealthSummary;
}
