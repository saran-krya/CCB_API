/** How long one dependency probe (database round trip, Redis PING) may take before it is reported as down. */
export const HEALTH_CHECK_TIMEOUT_MS = 3000;

/** Status of ONE dependency. */
export const COMPONENT_STATUS = {
  UP: 'up',
  DOWN: 'down',
} as const;
export type ComponentStatus = (typeof COMPONENT_STATUS)[keyof typeof COMPONENT_STATUS];

/** Overall verdict. `unhealthy`: the database is unreachable (the application cannot work). `degraded`: only Redis is down
 *  (caching, rate-limit counters and the session-liveness cache fall back to the database / in-process state, so the
 *  application keeps working). `healthy`: every dependency answered. */
export const OVERALL_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
} as const;
export type OverallStatus = (typeof OVERALL_STATUS)[keyof typeof OVERALL_STATUS];

/** What the page shows when a probe failed and the reason is not a recognisable error code. */
export const GENERIC_CHECK_FAILURE = 'Check failed';
export const CHECK_TIMED_OUT = 'Timed out';
