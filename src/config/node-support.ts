/**
 * Which Node.js majors CCB is built, tested and supported on — and the check that tells an operator when the server runs something else.
 *
 * The rule (docs/OPERATIONS.md): run an ACTIVE or MAINTENANCE LTS line of Node.js. CCB supports the lines listed in SUPPORTED_NODE_MAJORS
 * (package.json "engines" says the same). A runtime past its end of life no longer receives security fixes, so starting on one is logged as
 * a warning in every environment, and `ENFORCE_SUPPORTED_NODE=true` turns it into a start-up refusal for installations that want that.
 *
 * The end-of-life dates are the ones the Node.js project publishes (https://github.com/nodejs/release#release-schedule). The same table is
 * kept in CCB_Web (lib/constants/application-info.constants.ts), which is what the console's Application Information screen reads: when a
 * new major appears, add a row in BOTH.
 */

/** Majors verified by CI (the matrix in .github/workflows/ci.yml): the lines this release is tested on. */
export const SUPPORTED_NODE_MAJORS: readonly number[] = [22, 24];

/** When each major stops receiving security fixes (YYYY-MM-DD). */
export const NODE_END_OF_LIFE: Readonly<Record<number, string>> = {
  16: '2023-09-11',
  17: '2022-06-01',
  18: '2025-04-30',
  19: '2023-06-01',
  20: '2026-04-30',
  21: '2024-06-01',
  22: '2027-04-30',
  23: '2025-06-01',
  24: '2028-04-30',
  25: '2026-06-01',
  26: '2029-04-30',
};

export type NodeSupportStatus = 'supported' | 'endOfLife' | 'untested' | 'unknown';

export interface NodeSupport {
  /** The running version as `process.version` writes it (v22.12.0). */
  version: string;
  major: number | null;
  /** supported: a CI-verified major still receiving fixes · untested: receives fixes but is not one CCB is tested on · endOfLife: no more security
   *  fixes · unknown: the version string could not be read. */
  status: NodeSupportStatus;
  endOfLife: string | null;
}

/** The major of a version string such as "v22.12.0" (null when it is not one). */
export function nodeMajor(version: string): number | null {
  const match = /^v?(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : null;
}

/** Judges a Node.js version against the table. `today` is YYYY-MM-DD (a parameter so the rule is testable without a clock). */
export function assessNodeRuntime(version: string, today: string): NodeSupport {
  const major = nodeMajor(version);
  if (major === null) return { version, major, status: 'unknown', endOfLife: null };
  const endOfLife = Object.prototype.hasOwnProperty.call(NODE_END_OF_LIFE, major) ? NODE_END_OF_LIFE[major] : null;
  if (endOfLife !== null && today >= endOfLife) return { version, major, status: 'endOfLife', endOfLife };
  // A major older than the oldest row is certainly past its end of life; one newer than the newest has no verdict yet (never called unsupported).
  const oldest = Math.min(...Object.keys(NODE_END_OF_LIFE).map(Number));
  if (endOfLife === null && major < oldest) return { version, major, status: 'endOfLife', endOfLife };
  return { version, major, status: SUPPORTED_NODE_MAJORS.includes(major) ? 'supported' : 'untested', endOfLife };
}

export interface NodeRuntimeVerdict {
  support: NodeSupport;
  /** true when ENFORCE_SUPPORTED_NODE is on and the runtime is past its end of life: the process must not start. */
  refuse: boolean;
  /** The sentence for the start-up log, or null when there is nothing to say. */
  message: string | null;
}

/** What start-up should do about the running Node.js. Pure: main.ts logs the message and exits when `refuse` is set. */
export function judgeNodeRuntime(version: string, today: string, env: Record<string, string | undefined>): NodeRuntimeVerdict {
  const support = assessNodeRuntime(version, today);
  const enforce = ['1', 'true', 'yes', 'on'].includes((env.ENFORCE_SUPPORTED_NODE ?? '').trim().toLowerCase());
  const supportedList = SUPPORTED_NODE_MAJORS.map((m) => `Node ${m}`).join(' or ');
  if (support.status === 'endOfLife') {
    const since = support.endOfLife ? ` (end of life since ${support.endOfLife})` : '';
    return {
      support,
      refuse: enforce,
      message:
        `Node.js ${support.version} is past its end of life${since} and no longer receives security fixes. Run ${supportedList} (see docs/OPERATIONS.md, "Node.js").` +
        (enforce ? ' ENFORCE_SUPPORTED_NODE is on: refusing to start.' : ' Set ENFORCE_SUPPORTED_NODE=true to refuse to start on an unsupported runtime.'),
    };
  }
  if (support.status === 'untested') {
    return { support, refuse: false, message: `Node.js ${support.version} is not one of the versions CCB is tested on (${supportedList}); it should work, but it is not verified.` };
  }
  return { support, refuse: false, message: null };
}
