import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AuthPrincipal } from '../../auth/interfaces/authenticated-user.interface';
import { SECURITY_EVENT } from '../../audit/audit.constants';
import { SecurityEventService } from '../../audit/security-event.service';
import { PRINCIPAL_TYPE } from '../constants/auth.constants';

const HTTP_FORBIDDEN = 403;
const DEDUPE_WINDOW_MS = 60_000;
/** Bounds how many ACCESS_DENIED rows one user, and the trail overall, can gain per minute — the same shape as the
 *  sign-in lock-out's LOGIN_FAILED caps (docs/OPERATIONS.md §6: "12 a minute per account, 200 overall"): a flood
 *  (a script hitting every route it can reach) stays visible in the trail without being able to grow it without bound. */
const PER_USER_RATE = { max: 20, windowMs: DEDUPE_WINDOW_MS };
const OVERALL_RATE = { max: 200, windowMs: DEDUPE_WINDOW_MS };

/** 403 bodies that are a normal, expected part of a session/account-state flow — never an authorization refusal — so they are
 *  never recorded as ACCESS_DENIED. PASSWORD_CHANGE_REQUIRED is PasswordChangeGuard's own code (see its doc comment);
 *  MFA_ENROLLMENT_REQUIRED is reserved for the same reason once MFA enrollment is enforced the same way (not implemented yet —
 *  see SECURITY_EVENT.MFA_* in audit.constants.ts, which currently has no guard behind it). Listing a code that cannot occur
 *  yet costs nothing and keeps this list already correct once that guard exists. */
const EXCLUDED_CODES = new Set(['PASSWORD_CHANGE_REQUIRED', 'MFA_ENROLLMENT_REQUIRED']);

type RequestWithPrincipal = Request & { user?: AuthPrincipal };

/**
 * Writes a `security` / `ACCESS_DENIED` audit row whenever a SIGNED-IN STAFF request is refused with 403 by the
 * authorization guards (RolesGuard, PermissionGuard, CustomerAccessGuard, assignment-boundary and SUPER_ADMIN-protection
 * checks, …) — the moment `SECURITY_EVENT.ACCESS_DENIED` already documents ("A signed-in user was refused (403) by the
 * authorization guards. Recorded at most once a minute per user and route.") but that, until now, nothing actually wrote.
 *
 * Deliberately NOT a guard, an interceptor or part of GlobalExceptionFilter: those run BEFORE the response is written and
 * would have to duplicate each guard's own reasoning. This instead reads the one fact that is always already true once a
 * response is finished — its status code — from plain Express middleware mounted once in main.ts, so it sees every route
 * (and every version) the same way and never changes what a guard decided or how a response looks to the client.
 *
 * Scope: STAFF principals only. A customer-portal 403 (CustomerAccessGuard; "this unit/property/bill is not associated
 * with your account") is not recorded here: `audit_logs.performed_by` joins `users` (AuditModule's TypeOrmModule.forFeature),
 * and Customer ids are a SEPARATE id space from User ids (see the account-invitations migration's own note on this) — writing
 * a Customer id into that column would misattribute the row to whichever User happens to share that id, or leave the actor
 * blank. Auditing customer-portal refusals needs its own actor column/shape and is out of scope for this change.
 *
 * Request context kept: method, matched route PATTERN (never the raw URL — no id, email or query string) and the client
 * address Express already resolved honouring TRUST_PROXY (`req.ip`; see configure-http-security.ts). No request id exists
 * yet to propagate (planned: Phase 6, "structured logging and request IDs") — there is nothing to add until it does.
 * Never the request body, headers or the guard's own message text: an investigator needs who/what/where, never a payload
 * that might itself carry something sensitive.
 *
 * Failure handling: entirely SecurityEventService's own — `record()` already never throws (it logs and swallows), so a
 * database hiccup while writing this event can never turn an already-sent 403 response into a 500, and never retries into
 * the request path.
 */
@Injectable()
export class AccessDeniedAuditService {
  constructor(private readonly securityEvents: SecurityEventService) {}

  /** `app.use(accessDeniedAudit.middleware())` in main.ts — after the global filters/interceptors, so it sees the final
   *  status code of every route, including ones that throw before reaching a controller. */
  middleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      let body: unknown;
      // `res.on('finish')` fires after the response is fully sent, but by then the body itself is gone — the only
      // way to read it is to capture it as it is written.  json() is what HttpException responses use (see
      // GlobalExceptionFilter); if something else ever calls res.send()/write() directly for a 403, `body` just
      // stays undefined and the event is still recorded (only the EXCLUDED_CODES check needs `body`).
      const originalJson = res.json.bind(res);
      res.json = ((payload: unknown) => {
        body = payload;
        return originalJson(payload);
      }) as Response['json'];

      res.on('finish', () => {
        if (res.statusCode !== HTTP_FORBIDDEN) return;
        this.recordIfDenied(req, body);
      });

      next();
    };
  }

  private recordIfDenied(req: Request, body: unknown): void {
    const user = (req as RequestWithPrincipal).user;
    if (!user || user.type === PRINCIPAL_TYPE.CUSTOMER) return;

    const code = body && typeof body === 'object' ? (body as Record<string, unknown>).code : undefined;
    if (typeof code === 'string' && EXCLUDED_CODES.has(code)) return;

    const actorId = user.sub;
    const route = this.routeOf(req);
    const key = `${actorId}:${req.method}:${route}`;

    void this.securityEvents.record({
      action: SECURITY_EVENT.ACCESS_DENIED,
      actorId,
      entityId: actorId,
      details: { method: req.method, route, ip: req.ip },
      dedupeKey: key,
      dedupeWindowMs: DEDUPE_WINDOW_MS,
      rates: [
        { key: `access-denied:user:${actorId}`, ...PER_USER_RATE },
        { key: 'access-denied:overall', ...OVERALL_RATE },
      ],
    });
  }

  /** The route PATTERN Nest matched (e.g. `/api/v1/users/:id`), never the raw URL: `req.route.path` is the
   *  method-level pattern the matching controller/handler was registered with (no real id, email or query string
   *  in it); `req.baseUrl` is everything mounted in front of it (the global prefix, the version, the controller's
   *  own path). Express sets both once routing has matched — which it always has by the time a guard throws,
   *  guards running after route resolution — so this only ever falls back to the raw path for a 403 that somehow
   *  precedes routing (defensive; not a path this app's guard chain takes). */
  private routeOf(req: Request): string {
    const base = req.baseUrl ?? '';
    const matched = (req as Request & { route?: { path?: string } }).route?.path;
    return matched !== undefined ? `${base}${matched}` : req.path;
  }
}
