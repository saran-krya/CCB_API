import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ROLES } from '../../common/constants/global';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateTariffDto, RejectTariffDto, TariffQueryDto, UpdateTariffDto } from './dto/tariff.dto';
import { TariffService } from './tariff.service';

@ApiBearerAuth()
@ApiTags('Tariffs')
@Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
@Controller({ path: 'tariffs', version: '1' })
export class TariffController {
  constructor(private readonly tariffs: TariffService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get tariff dashboard stats' })
  getStats() {
    return this.tariffs.getStats();
  }

  @Get('metaFilters')
  @ApiOperation({ summary: 'Get filter metadata for the tariff list and create-form UI' })
  getFilterMetadata() {
    return this.tariffs.getFilterMetadata();
  }

  @Get()
  @ApiOperation({ summary: 'List tariffs with pagination, search, sort and filters' })
  findAll(@Query() query: TariffQueryDto) {
    return this.tariffs.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tariff detail by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tariffs.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a tariff (submitted for approval)' })
  create(@Body() dto: CreateTariffDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.create(dto, user?.sub);
  }

  @Patch(':id')
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
  @ApiOperation({ summary: 'Approve a pending tariff' })
  @ApiParam({ name: 'id', type: Number })
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.approve(id, user?.sub);
  }

  @Patch(':id/reject')
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
  @ApiOperation({ summary: 'Deactivate an active or pending tariff' })
  @ApiParam({ name: 'id', type: Number })
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.tariffs.deactivate(id, user?.sub);
  }
}
