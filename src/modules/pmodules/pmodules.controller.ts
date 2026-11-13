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
  ApiTags,
} from '@nestjs/swagger';

import { ROLES } from '@app/common/constants/global';

import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

import { PModulesService } from './pmodules.service';
import { ModuleCatalogQueryDto } from './dto/module-catalog.dto';

import {
  CreatePModuleDto,
  UpdatePModuleDto,
} from './dto/create-pmodule.dto';

@ApiBearerAuth()
@ApiTags('Permission Modules')
@Roles(ROLES.SUPER_ADMIN)
@Controller({
  path: 'pmodules',
  version: '1',
})
export class PModulesController {
  constructor(
    private readonly pModulesService: PModulesService,
  ) {}

  @Post()
  create(
    @Body() dto: CreatePModuleDto,
  ) {
    return this.pModulesService.create(dto);
  }

  // Declared before `:id` so "catalog" is never parsed as a module id.
  @Get('catalog')
  getCatalog(
    @Query() query: ModuleCatalogQueryDto,
  ) {
    return this.pModulesService.getCatalog(query);
  }

  @Get()
  findAll(
  ) {
    return this.pModulesService.findAll();
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.pModulesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePModuleDto,
  ) {
    return this.pModulesService.update(
      id,
      dto,
    );
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.pModulesService.remove(id);
  }
}