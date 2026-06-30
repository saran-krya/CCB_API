import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ROLES } from '../../common/constants/global';
import { CreateUnitDto, UpdateUnitDto } from './dto/create-unit.dto';
import { UnitService } from './unit.service';

@ApiBearerAuth()
@ApiTags('Units')
@Roles(ROLES.ADMIN, ROLES.OPERATIONS)
@Controller({ path: 'units', version: '1' })
export class UnitController {
  constructor(private readonly units: UnitService) {}

  @Post()
  create(@Body() dto: CreateUnitDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.units.create(dto, user?.sub);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.units.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.units.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() dto: UpdateUnitDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.units.update(id, dto, user?.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.units.remove(id, user?.sub);
  }
}
