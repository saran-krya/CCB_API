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

// Route-level @Roles() only — deliberately no controller-level guard.
// Super Admin/Admin create, edit, and initiate new versions; Finance
// approves/rejects; Super Admin alone deprecates. Approve/reject are a
// deliberate exception to this app's "Super Admin bypasses every @Roles()
// check" convention, re-enforced inside BillingCycleService itself
// (assertOnlyFinanceMayReview), the same pattern TariffService uses.
@ApiBearerAuth()
@ApiTags('Billing Cycles')
@Controller({ path: 'billing-cycles', version: '1' })
export class BillingCycleController {
  constructor(
    private readonly billingCycles: BillingCycleService,
    private readonly scheduler: BillingCycleSchedulerService,
  ) {}

  @Get('stats')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.FINANCE)
  @ApiOperation({ summary: 'Get billing cycle dashboard stats' })
  getStats() {
    return this.billingCycles.getStats();
  }

  @Get('metaFilters')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.FINANCE)
  @ApiOperation({ summary: 'Get filter metadata for the billing cycle list UI' })
  getFilterMetadata() {
    return this.billingCycles.getFilterMetadata();
  }

  @Get()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.FINANCE)
  @ApiOperation({ summary: 'List billing cycles with pagination and filters' })
  findAll(@Query() query: BillingCycleQueryDto) {
    return this.billingCycles.findAll(query);
  }

  @Get('property/:propertyId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.FINANCE)
  @ApiOperation({ summary: "Get the property's currently-governing billing cycle" })
  @ApiParam({ name: 'propertyId', type: Number })
  findByProperty(@Param('propertyId', ParseIntPipe) propertyId: number) {
    return this.billingCycles.findByProperty(propertyId);
  }

  @Get(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.FINANCE)
  @ApiOperation({ summary: 'Get billing cycle by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.billingCycles.findOne(id);
  }

  @Post()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.OPERATIONS)
  @ApiOperation({ summary: 'Create the first billing cycle for a property' })
  create(
    @Body() dto: CreateBillingCycleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.billingCycles.create(dto, user?.sub);
  }

  @Patch(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.OPERATIONS)
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
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
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
  @Roles(ROLES.FINANCE)
  @ApiOperation({ summary: 'Approve a pending billing cycle version (Finance only)' })
  @ApiParam({ name: 'id', type: Number })
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.billingCycles.approve(id, user?.sub, user?.roleName);
  }

  @Patch(':id/reject')
  @Roles(ROLES.FINANCE)
  @ApiOperation({ summary: 'Reject a pending billing cycle version (Finance only)' })
  @ApiParam({ name: 'id', type: Number })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectBillingCycleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.billingCycles.reject(id, dto, user?.sub, user?.roleName);
  }

  @Patch(':id/resubmit')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @ApiOperation({ summary: 'Resubmit a rejected billing cycle version back into the Finance approval queue' })
  @ApiParam({ name: 'id', type: Number })
  resubmit(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.billingCycles.resubmit(id, user?.sub);
  }

  @Patch(':id/deprecate')
  @Roles(ROLES.SUPER_ADMIN)
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
