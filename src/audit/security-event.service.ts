import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from './audit.service';
import { AUDIT_MODULE, SECURITY_EVENT } from './audit.constants';

export type SecurityEventName = (typeof SECURITY_EVENT)[keyof typeof SECURITY_EVENT];

/** At most `max` events with this key are recorded per window; the rest are dropped (the log line the caller writes is not affected). */
export interface SecurityEventRate {
  key: string;
  max: number;
  windowMs?: number;
}

export interface SecurityEventInput {
  action: SecurityEventName;
  /** The account the event concerns (the account that was locked, unlocked, signed in to …), when it is one of ours. */
  entityId?: number | null;
  /** Who did it, when a signed-in user did (an administrator unlocking an account); null for an unauthenticated client. */
  actorId?: number | null;
  /** Facts about the event. NEVER a password, a token, a secret, a one-time code or a hash — only what an investigator needs to read. */
  details?: Record<string, unknown>;
  /** With a key, an identical event is recorded once per `dedupeWindowMs`, so a flood (a guessing attack) cannot flood the audit trail with it. */
  dedupeKey?: string;
  dedupeWindowMs?: number;
  /** Rate caps, ALL of which must allow the event (for example: per account, and across all accounts). A distributed guessing attack that varies the
   *  client address defeats a per-client dedupe key; a cap per account and overall keeps the trail's growth bounded however the attack is spread. */
  rates?: SecurityEventRate[];
  /** The caller's transaction, when the event must commit or roll back with the change it describes. */
  manager?: EntityManager;
}

const DEFAULT_WINDOW_MS = 60_000;
const MAX_REMEMBERED_KEYS = 2_000;

/**
 * The ONE way security-relevant events enter the audit trail (module "security", verbs in SECURITY_EVENT), so they are filterable together, carry the
 * request context (IP address, client, request id) the audit service adds, and are written best-effort: a security flow (a sign-in, a refresh, a
 * lock-out) is never failed because its trail entry could not be written — the failure is logged for the operator instead.
 */
@Injectable()
export class SecurityEventService {
  private readonly logger = new Logger('SecurityEvents');
  private readonly recent = new Map<string, number>();
  private readonly counters = new Map<string, { start: number; count: number }>();

  constructor(private readonly audit: AuditService) {}

  async record(event: SecurityEventInput): Promise<void> {
    if (event.dedupeKey && this.seenRecently(event.dedupeKey, event.dedupeWindowMs ?? DEFAULT_WINDOW_MS)) return;
    if (event.rates && !this.withinRates(event.rates)) return;
    try {
      await this.audit.record(
        {
          moduleName: AUDIT_MODULE.SECURITY,
          entityId: event.entityId ?? undefined,
          action: event.action,
          newValue: event.details && Object.keys(event.details).length > 0 ? event.details : undefined,
          performedBy: event.actorId ?? undefined,
        },
        event.manager,
      );
    } catch (error) {
      this.logger.error(`Security event ${event.action} could not be recorded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private seenRecently(key: string, windowMs: number): boolean {
    const now = Date.now();
    const last = this.recent.get(key);
    if (last !== undefined && now - last < windowMs) return true;
    this.recent.set(key, now);
    if (this.recent.size > MAX_REMEMBERED_KEYS) this.prune(this.recent, (at) => now - at >= windowMs, (at) => at);
    return false;
  }

  /** True when EVERY cap still has room; only then are they all charged (an event refused by one cap does not use up the others). */
  private withinRates(rates: SecurityEventRate[]): boolean {
    const now = Date.now();
    const current = rates.map((rate) => {
      const windowMs = rate.windowMs ?? DEFAULT_WINDOW_MS;
      const counter = this.counters.get(rate.key);
      const live = counter && now - counter.start < windowMs ? counter : { start: now, count: 0 };
      return { rate, live };
    });
    if (current.some(({ rate, live }) => live.count >= rate.max)) return false;
    for (const { rate, live } of current) {
      live.count += 1;
      this.counters.set(rate.key, live);
    }
    if (this.counters.size > MAX_REMEMBERED_KEYS) {
      this.prune(this.counters, (counter) => now - counter.start >= DEFAULT_WINDOW_MS, (counter) => counter.start);
    }
    return true;
  }

  /** Drops expired entries; if a flood of distinct live keys keeps the map too big, drops the oldest half rather than grow without bound. */
  private prune<T>(map: Map<string, T>, expired: (value: T) => boolean, age: (value: T) => number): void {
    for (const [key, value] of map) if (expired(value)) map.delete(key);
    if (map.size > MAX_REMEMBERED_KEYS) {
      const oldest = [...map.entries()].sort((a, b) => age(a[1]) - age(b[1])).slice(0, Math.ceil(map.size / 2));
      for (const [key] of oldest) map.delete(key);
    }
  }
}
