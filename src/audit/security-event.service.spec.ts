import type { AuditService } from './audit.service';
import { SecurityEventService } from './security-event.service';
import { SECURITY_EVENT } from './audit.constants';

describe('SecurityEventService', () => {
  let audit: { record: jest.Mock };
  let service: SecurityEventService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new SecurityEventService(audit as unknown as AuditService);
  });
  afterEach(() => jest.useRealTimers());

  it('writes the event under the security module with its facts and actor', async () => {
    await service.record({ action: SECURITY_EVENT.SIGNIN_UNLOCKED, entityId: 7, actorId: 3, details: { countersCleared: 4 } });

    expect(audit.record).toHaveBeenCalledWith(
      { moduleName: 'security', entityId: 7, action: 'SIGNIN_UNLOCKED', newValue: { countersCleared: 4 }, performedBy: 3 },
      undefined,
    );
  });

  it('omits empty details and passes the caller transaction through', async () => {
    const manager = {} as never;
    await service.record({ action: SECURITY_EVENT.IP_LOCKED, details: {}, manager });
    expect(audit.record.mock.calls[0][0].newValue).toBeUndefined();
    expect(audit.record.mock.calls[0][1]).toBe(manager);
  });

  it('records an identical keyed event once per window', async () => {
    await service.record({ action: SECURITY_EVENT.LOGIN_FAILED, dedupeKey: 'k' });
    await service.record({ action: SECURITY_EVENT.LOGIN_FAILED, dedupeKey: 'k' });
    await service.record({ action: SECURITY_EVENT.LOGIN_FAILED, dedupeKey: 'other' });
    expect(audit.record).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(60_001);
    await service.record({ action: SECURITY_EVENT.LOGIN_FAILED, dedupeKey: 'k' });
    expect(audit.record).toHaveBeenCalledTimes(3);
  });

  it('caps a flood however it is spread: per-account and overall caps bound the rows, and every cap must allow the event', async () => {
    const rates = (account: string) => [
      { key: `acct:${account}`, max: 3 },
      { key: 'all', max: 5 },
    ];
    // One account attacked from 10 different clients (so a per-client dedupe key never matches): capped at 3 for that account.
    for (let i = 0; i < 10; i += 1) await service.record({ action: SECURITY_EVENT.LOGIN_FAILED, dedupeKey: `a:${i}`, rates: rates('a') });
    expect(audit.record).toHaveBeenCalledTimes(3);

    // A refused event does not use up the overall cap: another account still has the 2 that remain…
    for (let i = 0; i < 10; i += 1) await service.record({ action: SECURITY_EVENT.LOGIN_FAILED, dedupeKey: `b:${i}`, rates: rates('b') });
    expect(audit.record).toHaveBeenCalledTimes(5);

    // …and then the overall cap stops everything until the window ends.
    await service.record({ action: SECURITY_EVENT.LOGIN_FAILED, dedupeKey: 'c', rates: rates('c') });
    expect(audit.record).toHaveBeenCalledTimes(5);
    jest.advanceTimersByTime(60_001);
    await service.record({ action: SECURITY_EVENT.LOGIN_FAILED, dedupeKey: 'd', rates: rates('c') });
    expect(audit.record).toHaveBeenCalledTimes(6);
  });

  it('never fails the security flow it belongs to when the trail entry cannot be written', async () => {
    audit.record.mockRejectedValue(new Error('database gone'));
    await expect(service.record({ action: SECURITY_EVENT.ACCOUNT_LOCKED })).resolves.toBeUndefined();
  });

  it('keeps its memory bounded under a flood of distinct keys', async () => {
    for (let i = 0; i < 5000; i += 1) await service.record({ action: SECURITY_EVENT.LOGIN_FAILED, dedupeKey: `distinct:${i}`, rates: [{ key: `acct:${i}`, max: 1 }] });
    // Every distinct key is a first event, so all are recorded — the point is that this finishes without growing without bound.
    expect(audit.record).toHaveBeenCalledTimes(5000);
    expect((service as unknown as { recent: Map<string, number> }).recent.size).toBeLessThanOrEqual(2500);
    expect((service as unknown as { counters: Map<string, unknown> }).counters.size).toBeLessThanOrEqual(2500);
  });
});
