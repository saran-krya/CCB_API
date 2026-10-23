import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { DashboardConsumptionQueryDto } from './dto/dashboard-query.dto';

/**
 * Deliberately open to ANY authenticated staff session — no `@Roles`/`@Permission` on this
 * controller or any of its routes, confirmed as intentional (RBAC security-assessment review) rather
 * than an oversight, same category as `AttributeController`'s own open GETs:
 *   - The seeded `DASHBOARD` PModule (`url: '/'`, `displayOrder: 1`) is the application's universal
 *     staff landing page — every role lands here immediately after login — and has zero SubModule/
 *     Screen/Action rows under it anywhere in seed-data.ts, so there is no existing permission code
 *     this could even be gated by without inventing one.
 *   - The frontend's own dashboard page (`app/(protected)/page.tsx`) calls these 4 endpoints with no
 *     `usePermission(...)` check of any kind — confirming the product's own intent is "every staff
 *     role sees this," not a role-scoped view.
 *   - `CustomerAccessGuard` already denies every route here to a customer session (a route with no
 *     `@CustomerAccessible()` is staff-only by default — see that guard's own doc comment), so the
 *     real reachable audience is "any authenticated staff member," never a customer token.
 * If a future requirement needs role-scoped dashboard data, that is a product decision (which roles,
 * which widgets) this comment cannot make — add the real `Action` row(s) first, then `@Permission`.
 */
@ApiBearerAuth()
@ApiTags('Dashboard')
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get platform-wide dashboard stat cards' })
  getStats() {
    return this.dashboard.getStats();
  }

  @Get('unit-occupancy')
  @ApiOperation({ summary: 'Get residential/commercial unit occupancy breakdown' })
  getUnitOccupancy() {
    return this.dashboard.getUnitOccupancy();
  }

  @Get('consumption')
  @ApiOperation({ summary: 'Get community consumption chart data for a given month' })
  getConsumption(@Query() query: DashboardConsumptionQueryDto) {
    return this.dashboard.getConsumption(query.month);
  }

  @Get('billing-pipeline')
  @ApiOperation({ summary: 'Get billing cycle revenue pipeline chart data for a given month' })
  getBillingPipeline(@Query() query: DashboardConsumptionQueryDto) {
    return this.dashboard.getBillingPipeline(query.month);
  }
}
