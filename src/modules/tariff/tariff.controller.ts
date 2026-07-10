import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ROLES } from '../../common/constants/global';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import {
  CreateTariffDto,
  RejectTariffDto,
  TariffConflictQueryDto,
  TariffQueryDto,
  UpdateTariffDto,
} from './dto/tariff.dto';
import { TariffSchedulerService } from './tariff-scheduler.service';
import { TariffService } from './tariff.service';

// Route-level @Permission() — gates business routes by Screen Action
// (TARIFF_MANAGEMENT screen) instead of hardcoded roles, so access is
// controlled entirely through Role Permissions per role, not role names.
// PermissionGuard has no role bypass of any kind — approve/reject are
// gated exactly like every other action, purely by whether the caller's
// role holds the TARIFF_APPROVE/TARIFF_REJECT grant (seeded to every role
// except SUPER_ADMIN/ADMIN by default; assign it to FINANCE via Role
// Management to restore today's behavior). run-scheduler stays on
// @Roles(SUPER_ADMIN) — it's an ops/testing utility, not a business action
// a role would be granted, so it's excluded from this migration.

@ApiBearerAuth()
@ApiTags('Tariffs')
@Controller({ path: 'tariffs', version: '1' })
export class TariffController {
  constructor(
    private readonly tariffs: TariffService,
    private readonly scheduler: TariffSchedulerService,
  ) {}

  @Get('stats')
  @Permission('TARIFF_VIEW')
  @ApiOperation({ summary: 'Get tariff dashboard stats' })
  getStats() {
    return this.tariffs.getStats();
  }

  @Get('metaFilters')
  @Permission('TARIFF_VIEW')
  @ApiOperation({ summary: 'Get filter metadata for the tariff list and create-form UI' })
  getFilterMetadata() {
    return this.tariffs.getFilterMetadata();
  }

  @Get('check-conflict')
  @Permission('TARIFF_CREATE', 'TARIFF_EDIT')
  @ApiOperation({ summary: 'Check whether a proposed tariff scope/date range conflicts with an existing tariff' })
  checkConflict(@Query() query: TariffConflictQueryDto) {
    return this.tariffs.checkConflict(query);
  }

  @Get()
  @Permission('TARIFF_VIEW')
  @ApiOperation({ summary: 'List tariffs with pagination, search, sort and filters' })
  findAll(@Query() query: TariffQueryDto) {
    return this.tariffs.findAll(query);
  }

  @Get(':id')
  @Permission('TARIFF_VIEW')
  @ApiOperation({ summary: 'Get tariff detail by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tariffs.findOne(id);
  }

  @Get(':id/versions')
  @Permission('TARIFF_VIEW')
  @ApiOperation({ summary: "Get every version of this tariff's lineage, oldest first" })
  @ApiParam({ name: 'id', type: Number })
  getVersionHistory(@Param('id', ParseIntPipe) id: number) {
    return this.tariffs.getVersionHistory(id);
  }

  @Post()
  @Permission('TARIFF_CREATE')
  @ApiOperation({ summary: 'Create a tariff (submitted for approval)' })
  create(@Body() dto: CreateTariffDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.create(dto, user?.sub);
  }

  @Patch(':id')
  @Permission('TARIFF_EDIT')
  @ApiOperation({ summary: 'Update a draft, corrected, rejected, inactive, or active tariff (pending is locked until Finance decides)' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTariffDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.tariffs.update(id, dto, user?.sub);
  }

  @Patch(':id/submit')
  @Permission('TARIFF_SUBMIT')
  @ApiOperation({ summary: 'Submit a draft, corrected, or rejected tariff for Finance approval' })
  @ApiParam({ name: 'id', type: Number })
  submit(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.submit(id, user?.sub);
  }

  @Patch(':id/approve')
  @Permission('TARIFF_APPROVE')
  @ApiOperation({ summary: 'Approve a pending tariff (requires the TARIFF_APPROVE grant)' })
  @ApiParam({ name: 'id', type: Number })
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.approve(id, user?.sub);
  }

  @Patch(':id/reject')
  @Permission('TARIFF_REJECT')
  @ApiOperation({ summary: 'Reject a pending tariff (requires the TARIFF_REJECT grant)' })
  @ApiParam({ name: 'id', type: Number })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectTariffDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.tariffs.reject(id, dto, user?.sub);
  }

  @Patch(':id/deactivate')
  @Permission('TARIFF_DEACTIVATE')
  @ApiOperation({ summary: 'Deactivate an active tariff' })
  @ApiParam({ name: 'id', type: Number })
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.deactivate(id, user?.sub);
  }

  @Patch(':id/reactivate')
  @Permission('TARIFF_REACTIVATE')
  @ApiOperation({ summary: 'Reactivate an inactive tariff back to active' })
  @ApiParam({ name: 'id', type: Number })
  reactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.reactivate(id, user?.sub);
  }

  @Patch(':id/deprecate')
  @Permission('TARIFF_DEPRECATE')
  @ApiOperation({ summary: 'Manually deprecate an active tariff (Super Admin only)' })
  @ApiParam({ name: 'id', type: Number })
  deprecate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.deprecate(id, user?.sub);
  }

  @Post(':id/new-version')
  @Permission('TARIFF_NEW_VERSION')
  @ApiOperation({ summary: 'Clone an active tariff into a new editable draft version' })
  @ApiParam({ name: 'id', type: Number })
  newVersion(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.newVersion(id, user?.sub);
  }

  @Post('run-scheduler')
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Manually run the auto-deprecate/auto-expire jobs now (Super Admin only, for ops/testing)' })
  async runScheduler() {
    const [deprecated, expired] = await Promise.all([
      this.scheduler.autoDeprecateSupersededVersions(),
      this.scheduler.autoExpirePastEffectiveTo(),
    ]);
    return { deprecated, expired };
  }
}
