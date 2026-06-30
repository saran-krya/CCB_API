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
import { Roles } from '../../common/decorators/roles.decorator';
import { ROLES } from '../../common/constants/global';
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
@Roles(ROLES.ADMIN, ROLES.OPERATIONS)
@Controller({ path: 'units', version: '1' })
export class UnitController {
  constructor(private readonly units: UnitService) {}

  @Post()
  @ApiOperation({ summary: 'Create a unit' })
  create(
    @Body() dto: CreateUnitDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.units.create(dto, user?.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List all units with pagination and filters' })
  @ApiOkResponse({ type: UnitListDto, isArray: true, description: 'Paginated list of units' })
  findAll(@Query() query: UnitQueryDto) {
    return this.units.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get unit detail' })
  @ApiOkResponse({ type: UnitDetailDto })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.units.findOne(id);
  }

  @Patch(':id')
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
  @ApiOperation({ summary: 'Soft-delete a unit' })
  @ApiParam({ name: 'id', type: Number })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.units.remove(id, user?.sub);
  }
}
