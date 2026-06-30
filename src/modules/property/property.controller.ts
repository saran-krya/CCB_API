import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ROLES } from '../../common/constants/global';
import { CreatePropertyDto, UpdatePropertyDto } from './dto/create-property.dto';
import { PropertyService } from './property.service';

@ApiBearerAuth()
@ApiTags('Properties')
@Roles(ROLES.ADMIN, ROLES.OPERATIONS)
@Controller({ path: 'properties', version: '1' })
export class PropertyController {
  constructor(private readonly properties: PropertyService) {}

  @Post()
  create(@Body() dto: CreatePropertyDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.properties.create(dto, user?.sub);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.properties.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.properties.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() dto: UpdatePropertyDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.properties.update(id, dto, user?.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.properties.remove(id, user?.sub);
  }
}
