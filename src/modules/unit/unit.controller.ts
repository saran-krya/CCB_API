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

// Route-level @Permission() — gates business routes by Screen Action
// (UNIT screen) instead of hardcoded roles, so access is controlled
// entirely through Role Permissions per role, not role names.
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

  @Get()
  @Permission('VIEW_UNIT')
  @ApiOperation({ summary: 'List all units with pagination and filters' })
  @ApiOkResponse({ type: UnitListDto, isArray: true, description: 'Paginated list of units' })
  findAll(@Query() query: UnitQueryDto) {
    return this.units.findAll(query);
  }

  @Get(':id')
  @Permission('VIEW_UNIT')
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
