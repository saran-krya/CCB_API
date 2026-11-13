import { ComponentStatus, OverallStatus } from '../system-health.constants';

/** One probed dependency. `latencyMs` is the measured round trip of a successful probe, `null` when it failed; `error` is a
 *  short reason (an error code or "Timed out") — never a connection string, host, user or password. */
export interface DependencyHealth {
  status: ComponentStatus;
  latencyMs: number | null;
  error: string | null;
}

export interface DatabaseHealth extends DependencyHealth {
  /** `SELECT VERSION()` of the connected server, `null` when the probe failed. */
  serverVersion: string | null;
}

export interface ApiRuntimeHealth {
  status: ComponentStatus;
  environment: string;
  nodeVersion: string;
  uptimeSeconds: number;
  /** `heapLimitBytes` is the most V8 will let the heap grow to (`--max-old-space-size`, or the platform default) — the capacity heap use
   *  is measured against. `heapTotalBytes` is only what V8 has reserved so far: it grows on demand, so used/total reads 90% and more on
   *  a perfectly healthy process and says nothing about running out. */
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number; heapLimitBytes: number };
}

/** Facts about the machine the API runs on, straight from the operating system. A value the platform cannot report is
 *  `null` (for example the load average on Windows) — never a made-up number. */
export interface ServerHealth {
  platform: string;
  osUptimeSeconds: number;
  cpuCount: number;
  loadAverage: [number, number, number] | null;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  disk: { totalBytes: number; freeBytes: number } | null;
}

export interface SystemHealthResponse {
  status: OverallStatus;
  checkedAt: string;
  api: ApiRuntimeHealth;
  database: DatabaseHealth;
  redis: DependencyHealth;
  server: ServerHealth;
}

/** The compact form other screens (the SUPER_ADMIN dashboard) embed — verdict plus each dependency's own status. */
export interface SystemHealthSummary {
  status: OverallStatus;
  checkedAt: string;
  api: ComponentStatus;
  database: ComponentStatus;
  redis: ComponentStatus;
}
