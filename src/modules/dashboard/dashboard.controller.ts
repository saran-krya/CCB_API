import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { DashboardConsumptionQueryDto } from './dto/dashboard-query.dto';

// No @Roles()/@Permission() here on purpose — this is the platform landing
// page, visible to every authenticated user regardless of role. The global
// auth guard still requires a valid session; there is simply no additional
// module-level restriction layered on top of it.
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
