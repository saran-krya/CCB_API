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
import { TariffService } from './tariff.service';

// Route-level @Roles() only — deliberately no controller-level guard.
// Business Admin (SUPER_ADMIN/ADMIN) creates and edits; Finance Team
// (FINANCE, plus SUPER_ADMIN as the global override already enforced by
// RolesGuard) reviews and decides. See the Tariff Gap Analysis doc, §1/§7.
@ApiBearerAuth()
@ApiTags('Tariffs')
@Controller({ path: 'tariffs', version: '1' })
export class TariffController {
  constructor(private readonly tariffs: TariffService) {}

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

  @Patch(':id/approve')
  @Roles(ROLES.SUPER_ADMIN, ROLES.FINANCE)
  @ApiOperation({ summary: 'Approve a pending tariff' })
  @ApiParam({ name: 'id', type: Number })
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.approve(id, user?.sub);
  }

  @Patch(':id/reject')
  @Roles(ROLES.SUPER_ADMIN, ROLES.FINANCE)
  @ApiOperation({ summary: 'Reject a pending tariff' })
  @ApiParam({ name: 'id', type: Number })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectTariffDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.tariffs.reject(id, dto, user?.sub);
  }

  @Patch(':id/deactivate')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @ApiOperation({ summary: 'Deactivate an active or pending tariff' })
  @ApiParam({ name: 'id', type: Number })
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.deactivate(id, user?.sub);
  }
}
