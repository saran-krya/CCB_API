import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

const ORGANIZATION_ID_KEY = 'organizationId';

/**
 * The one place a request's tenant scope lives — a thin wrapper over nestjs-cls's
 * AsyncLocalStorage-backed store, so every layer (guards, services, repositories) reads the SAME
 * value for the lifetime of one request without threading it through every method signature.
 *
 * Set exactly once per request, by OrganizationContextGuard, from the already-live-resolved
 * authenticated principal (see JwtStrategy.validate) — never from a client-supplied header, query
 * parameter or request body, and never re-derived here. `null` means platform-level (the one
 * SUPER_ADMIN user) or an unauthenticated `@Public()` route with no principal at all; everything
 * else gets a real organization id. Reading before OrganizationContextGuard has run (there is no such
 * code path today, since it's the first guard after JwtAuthGuard) would return `undefined` —
 * `getOrganizationId()` normalizes that to `null` rather than letting callers special-case it.
 */
@Injectable()
export class OrganizationContextService {
  constructor(private readonly cls: ClsService) {}

  setOrganizationId(organizationId: number | null): void {
    this.cls.set(ORGANIZATION_ID_KEY, organizationId);
  }

  getOrganizationId(): number | null {
    return this.cls.get<number | null>(ORGANIZATION_ID_KEY) ?? null;
  }
}
