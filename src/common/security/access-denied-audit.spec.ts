import type { NextFunction, Request, Response } from 'express';
import { AccessDeniedAuditService } from './access-denied-audit';
import { SECURITY_EVENT } from '../../audit/audit.constants';
import type { SecurityEventService } from '../../audit/security-event.service';

function buildReq(overrides: Record<string, unknown> = {}): Request {
  return {
    method: 'GET',
    baseUrl: '/api/v1/users',
    route: { path: '/:id' },
    path: '/api/v1/users/42',
    ip: '203.0.113.9',
    user: { sub: 7, type: 'staff', email: 'admin@example.com', roleId: 1, roleName: 'ADMIN' },
    ...overrides,
  } as unknown as Request;
}

function buildRes(statusCode: number): Response & { emitFinish: () => void } {
  const handlers: Array<() => void> = [];
  const res = {
    statusCode,
    on: (event: string, cb: () => void) => {
      if (event === 'finish') handlers.push(cb);
      return res;
    },
    json: jest.fn((payload: unknown) => payload),
    emitFinish: () => handlers.forEach((cb) => cb()),
  };
  return res as unknown as Response & { emitFinish: () => void };
}

describe('AccessDeniedAuditService', () => {
  let securityEvents: { record: jest.Mock };
  let service: AccessDeniedAuditService;

  beforeEach(() => {
    securityEvents = { record: jest.fn().mockResolvedValue(undefined) };
    service = new AccessDeniedAuditService(securityEvents as unknown as SecurityEventService);
  });

  /** Runs the middleware, optionally has the "handler" send a JSON body (as GlobalExceptionFilter does for every
   *  HttpException), then fires the response's `finish` event — the point at which the service decides. */
  function run(req: Request, res: Response & { emitFinish: () => void }, body?: unknown): void {
    const next = jest.fn() as unknown as NextFunction;
    service.middleware()(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    if (body !== undefined) res.json(body);
    res.emitFinish();
  }

  it('records ACCESS_DENIED for a signed-in staff 403, keyed by the matched route PATTERN (no raw id)', () => {
    run(buildReq(), buildRes(403), { message: 'nope' });

    expect(securityEvents.record).toHaveBeenCalledTimes(1);
    const call = securityEvents.record.mock.calls[0][0];
    expect(call.action).toBe(SECURITY_EVENT.ACCESS_DENIED);
    expect(call.actorId).toBe(7);
    expect(call.entityId).toBe(7);
    expect(call.details).toEqual({ method: 'GET', route: '/api/v1/users/:id', ip: '203.0.113.9' });
  });

  it('ignores a non-403 response', () => {
    run(buildReq(), buildRes(200), { ok: true });
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('ignores an unauthenticated 403 (no principal attached — nothing to attribute it to)', () => {
    run(buildReq({ user: undefined }), buildRes(403));
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('ignores a customer-portal 403 — Customer ids are a separate id space from the users table performed_by joins', () => {
    run(buildReq({ user: { sub: 7, type: 'customer' } }), buildRes(403));
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('excludes PASSWORD_CHANGE_REQUIRED — a session-state refusal, not an authorization denial', () => {
    run(buildReq(), buildRes(403), { code: 'PASSWORD_CHANGE_REQUIRED', message: 'change your password' });
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('excludes the reserved MFA_ENROLLMENT_REQUIRED code even though no guard raises it yet', () => {
    run(buildReq(), buildRes(403), { code: 'MFA_ENROLLMENT_REQUIRED' });
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  it('still records a 403 whose body was never captured (res.send/write instead of res.json)', () => {
    run(buildReq(), buildRes(403));
    expect(securityEvents.record).toHaveBeenCalledTimes(1);
  });

  it('builds a dedupe key scoped to this user, method and route, plus per-user and overall rate caps', () => {
    run(buildReq(), buildRes(403));

    const call = securityEvents.record.mock.calls[0][0];
    expect(call.dedupeKey).toBe('7:GET:/api/v1/users/:id');
    expect(call.dedupeWindowMs).toBe(60_000);
    expect(call.rates).toEqual([
      { key: 'access-denied:user:7', max: 20, windowMs: 60_000 },
      { key: 'access-denied:overall', max: 200, windowMs: 60_000 },
    ]);
  });

  it('falls back to the raw path when routing has not matched (defensive — not a path the guard chain takes)', () => {
    run(buildReq({ route: undefined, baseUrl: undefined, path: '/api/v1/unmatched' }), buildRes(403));
    expect(securityEvents.record.mock.calls[0][0].details.route).toBe('/api/v1/unmatched');
  });

  it('does not await the write, so it can never turn an already-sent response into a hung request', () => {
    let resolveRecord!: () => void;
    securityEvents.record.mockReturnValue(new Promise<void>((resolve) => { resolveRecord = resolve; }));
    run(buildReq(), buildRes(403));
    expect(securityEvents.record).toHaveBeenCalledTimes(1); // returned already, although the promise above is still pending
    resolveRecord();
  });
});
