import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import {
  CreateUnitDto,
  UnitQueryDto,
  UpdateOccupancyDto,
  UpdateUnitDto,
} from './dto/create-unit.dto';
import { UnitDetailDto, UnitListDto } from './dto/unit-response.dto';
import { UnitService } from './unit.service';

@ApiBearerAuth()
@ApiTags('Units')
@Controller({ path: 'units', version: '1' })
export class UnitController {
  constructor(private readonly units: UnitService) {}

  @Post()
  @Permission('CREATE_UNIT')
  @ApiOperation({ summary: 'Create a unit' })
  create(
    @Body() dto: CreateUnitDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.units.create(dto, user?.sub);
  }

  // Also CREATE_REGISTRATION_REQUEST/EDIT_REGISTRATION_REQUEST and TARIFF_CREATE/TARIFF_EDIT: same
  // reasoning as the GET :id route below — Registration creation's unit-selection step and Tariff
  // creation's applicability picker read this list as reference data, not to manage Unit as a
  // module. Does NOT grant create/edit/delete.
  @Get()
  @Permission('VIEW_UNIT', 'CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST', 'TARIFF_CREATE', 'TARIFF_EDIT')
  @ApiOperation({ summary: 'List all units with pagination and filters' })
  @ApiOkResponse({ type: UnitListDto, isArray: true, description: 'Paginated list of units' })
  findAll(@Query() query: UnitQueryDto) {
    return this.units.findAll(query);
  }

  // Also VIEW_COMMUNITY: same reasoning as PropertyController's GET :id — the Communities
  // feature's own unit drill-through page (communities/[id]/properties/[propertyId]/units/[unitId])
  // needs this same read-only detail, and PropertyDetailDto already summarizes each unit inline for
  // a Community viewer. Does NOT grant create/edit/delete (still CREATE_UNIT/EDIT_UNIT/DELETE_UNIT
  // only).
  // Also CREATE_REGISTRATION_REQUEST/EDIT_REGISTRATION_REQUEST: Registration creation's
  // useUnitsByIdsQuery re-fetches each selected unit's own detail by id (useRegistrationCreation.ts)
  // as reference data, not to manage Unit as a module. Tariff's applicability picker only calls the
  // LIST endpoint above, never this by-id route, so TARIFF_CREATE/TARIFF_EDIT are deliberately not
  // added here.
  @Get(':id')
  @Permission('VIEW_UNIT', 'VIEW_COMMUNITY', 'CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Get unit detail' })
  @ApiOkResponse({ type: UnitDetailDto })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.units.findOne(id);
  }

  @Patch(':id')
  @Permission('EDIT_UNIT')
  @ApiOperation({ summary: 'Update unit' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUnitDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.units.update(id, dto, user?.sub);
  }

  @Patch(':id/occupancy')
  @Permission('UNIT_OCCUPANCY')
  @ApiOperation({ summary: 'Update unit occupancy status' })
  @ApiParam({ name: 'id', type: Number })
  updateOccupancy(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOccupancyDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.units.updateOccupancy(id, dto, user?.sub);
  }

  @Delete(':id')
  @Permission('DELETE_UNIT')
  @ApiOperation({ summary: 'Soft-delete a unit' })
  @ApiParam({ name: 'id', type: Number })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.units.remove(id, user?.sub);
  }
}
