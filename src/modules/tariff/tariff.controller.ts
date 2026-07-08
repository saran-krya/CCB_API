import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ROLES } from '../../common/constants/global';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateTariffDto,
  RejectTariffDto,
  TariffConflictQueryDto,
  TariffQueryDto,
  UpdateTariffDto,
} from './dto/tariff.dto';
import { TariffSchedulerService } from './tariff-scheduler.service';
import { TariffService } from './tariff.service';

// Route-level @Roles() only — deliberately no controller-level guard.
// Business Admin (SUPER_ADMIN/ADMIN) creates and edits; Finance Team reviews
// and decides. Approve/reject are a deliberate exception to this app's
// otherwise-global "Super Admin bypasses every @Roles() check" convention
// (RolesGuard.canActivate short-circuits on roleName === SUPER_ADMIN) — per
// explicit business rule, Super Admin and Admin must NOT be able to approve
// or reject a tariff, so that check is re-enforced inside TariffService
// itself (assertOnlyFinanceMayReview), not just at the guard.

@ApiBearerAuth()
@ApiTags('Tariffs')
@Controller({ path: 'tariffs', version: '1' })
export class TariffController {
  constructor(
    private readonly tariffs: TariffService,
    private readonly scheduler: TariffSchedulerService,
  ) {}

  @Get('stats')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE)
  @ApiOperation({ summary: 'Get tariff dashboard stats' })
  getStats() {
    return this.tariffs.getStats();
  }

  @Get('metaFilters')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE)
  @ApiOperation({ summary: 'Get filter metadata for the tariff list and create-form UI' })
  getFilterMetadata() {
    return this.tariffs.getFilterMetadata();
  }

  @Get('check-conflict')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @ApiOperation({ summary: 'Check whether a proposed tariff scope/date range conflicts with an existing tariff' })
  checkConflict(@Query() query: TariffConflictQueryDto) {
    return this.tariffs.checkConflict(query);
  }

  @Get()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE)
  @ApiOperation({ summary: 'List tariffs with pagination, search, sort and filters' })
  findAll(@Query() query: TariffQueryDto) {
    return this.tariffs.findAll(query);
  }

  @Get(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE)
  @ApiOperation({ summary: 'Get tariff detail by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tariffs.findOne(id);
  }

  @Post()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @ApiOperation({ summary: 'Create a tariff (submitted for approval)' })
  create(@Body() dto: CreateTariffDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.create(dto, user?.sub);
  }

  @Patch(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @ApiOperation({ summary: 'Update a pending or inactive tariff' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTariffDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.tariffs.update(id, dto, user?.sub);
  }

  @Patch(':id/submit')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @ApiOperation({ summary: 'Submit a draft, corrected, or rejected tariff for Finance approval' })
  @ApiParam({ name: 'id', type: Number })
  submit(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.submit(id, user?.sub);
  }

  @Patch(':id/approve')
  @Roles(ROLES.FINANCE)
  @ApiOperation({ summary: 'Approve a pending tariff (Finance only — Super Admin and Admin are explicitly excluded)' })
  @ApiParam({ name: 'id', type: Number })
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.approve(id, user?.sub, user?.roleName);
  }

  @Patch(':id/reject')
  @Roles(ROLES.FINANCE)
  @ApiOperation({ summary: 'Reject a pending tariff (Finance only — Super Admin and Admin are explicitly excluded)' })
  @ApiParam({ name: 'id', type: Number })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectTariffDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.tariffs.reject(id, dto, user?.sub, user?.roleName);
  }

  @Patch(':id/deactivate')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @ApiOperation({ summary: 'Deactivate an active or pending tariff' })
  @ApiParam({ name: 'id', type: Number })
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.deactivate(id, user?.sub);
  }

  @Patch(':id/reactivate')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @ApiOperation({ summary: 'Reactivate an inactive tariff back to active' })
  @ApiParam({ name: 'id', type: Number })
  reactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.reactivate(id, user?.sub);
  }

  @Patch(':id/deprecate')
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Manually deprecate an active tariff (Super Admin only)' })
  @ApiParam({ name: 'id', type: Number })
  deprecate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.deprecate(id, user?.sub);
  }

  @Post(':id/new-version')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
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
