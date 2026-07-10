import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { ROLES } from '../../common/constants/global';
import { BillingCycleService } from './billing-cycle.service';
import { BillingCycleSchedulerService } from './billing-cycle-scheduler.service';
import {
  BillingCycleQueryDto,
  CreateBillingCycleDto,
  DeprecateBillingCycleDto,
  NewVersionBillingCycleDto,
  RejectBillingCycleDto,
  UpdateBillingCycleDto,
} from './dto/billing-cycle.dto';

// Route-level @Permission() — gates business routes by Screen Action
// (BILLING_CYCLE screen) instead of hardcoded roles, so access is
// controlled entirely through Role Permissions per role, not role names.
// PermissionGuard has no role bypass of any kind — approve/reject are
// gated exactly like every other action, purely by whether the caller's
// role holds the BILLING_CYCLE_APPROVE/BILLING_CYCLE_REJECT grant (seeded
// to every role except SUPER_ADMIN/ADMIN by default; assign it to FINANCE
// via Role Management to restore today's behavior). run-scheduler stays on
// @Roles(SUPER_ADMIN) — it's an ops/testing utility, not a business action
// a role would be granted.
@ApiBearerAuth()
@ApiTags('Billing Cycles')
@Controller({ path: 'billing-cycles', version: '1' })
export class BillingCycleController {
  constructor(
    private readonly billingCycles: BillingCycleService,
    private readonly scheduler: BillingCycleSchedulerService,
  ) {}

  @Get('stats')
  @Permission('VIEW_BILLING_CYCLE')
  @ApiOperation({ summary: 'Get billing cycle dashboard stats' })
  getStats() {
    return this.billingCycles.getStats();
  }

  @Get('metaFilters')
  @Permission('VIEW_BILLING_CYCLE')
  @ApiOperation({ summary: 'Get filter metadata for the billing cycle list UI' })
  getFilterMetadata() {
    return this.billingCycles.getFilterMetadata();
  }

  @Get()
  @Permission('VIEW_BILLING_CYCLE')
  @ApiOperation({ summary: 'List billing cycles with pagination and filters' })
  findAll(@Query() query: BillingCycleQueryDto) {
    return this.billingCycles.findAll(query);
  }

  @Get('property/:propertyId')
  @Permission('VIEW_BILLING_CYCLE')
  @ApiOperation({ summary: "Get the property's currently-governing billing cycle" })
  @ApiParam({ name: 'propertyId', type: Number })
  findByProperty(@Param('propertyId', ParseIntPipe) propertyId: number) {
    return this.billingCycles.findByProperty(propertyId);
  }

  @Get(':id')
  @Permission('VIEW_BILLING_CYCLE')
  @ApiOperation({ summary: 'Get billing cycle by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.billingCycles.findOne(id);
  }

  @Post()
  @Permission('CREATE_BILLING_CYCLE')
  @ApiOperation({ summary: 'Create the first billing cycle for a property' })
  create(
    @Body() dto: CreateBillingCycleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.billingCycles.create(dto, user?.sub);
  }

  @Patch(':id')
  @Permission('EDIT_BILLING_CYCLE')
  @ApiOperation({ summary: 'Update a billing cycle (reading-window fields are locked — use new-version instead)' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBillingCycleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.billingCycles.update(id, dto, user?.sub);
  }

  @Post(':id/new-version')
  @Permission('BILLING_CYCLE_NEW_VERSION')
  @ApiOperation({ summary: "Clone a property's billing cycle into a new pending version with a changed reading window" })
  @ApiParam({ name: 'id', type: Number })
  newVersion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: NewVersionBillingCycleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.billingCycles.newVersion(id, dto, user?.sub);
  }

  @Patch(':id/approve')
  @Permission('BILLING_CYCLE_APPROVE')
  @ApiOperation({ summary: 'Approve a pending billing cycle version (requires the BILLING_CYCLE_APPROVE grant)' })
  @ApiParam({ name: 'id', type: Number })
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.billingCycles.approve(id, user?.sub);
  }

  @Patch(':id/reject')
  @Permission('BILLING_CYCLE_REJECT')
  @ApiOperation({ summary: 'Reject a pending billing cycle version (requires the BILLING_CYCLE_REJECT grant)' })
  @ApiParam({ name: 'id', type: Number })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectBillingCycleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.billingCycles.reject(id, dto, user?.sub);
  }

  @Patch(':id/resubmit')
  @Permission('BILLING_CYCLE_RESUBMIT')
  @ApiOperation({ summary: 'Resubmit a rejected billing cycle version back into the Finance approval queue' })
  @ApiParam({ name: 'id', type: Number })
  resubmit(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.billingCycles.resubmit(id, user?.sub);
  }

  @Patch(':id/deprecate')
  @Permission('BILLING_CYCLE_DEPRECATE')
  @ApiOperation({ summary: 'Deprecate a billing cycle version (Super Admin only)' })
  @ApiParam({ name: 'id', type: Number })
  deprecate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeprecateBillingCycleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.billingCycles.deprecate(id, dto, user?.sub);
  }

  @Post('run-scheduler')
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Manually run the auto-activate and auto-deprecate jobs now (Super Admin only, for ops/testing)' })
  async runScheduler() {
    const [activated, deprecated] = await Promise.all([
      this.scheduler.autoActivatePendingVersions(),
      this.scheduler.autoDeprecateScheduledCycles(),
    ]);
    return { activated, deprecated };
  }
}
