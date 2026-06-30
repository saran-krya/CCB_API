import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { SubModulesService } from './sub-modules.service';
import {
  CreateSubModuleDto,
  UpdateSubModuleDto,
} from './dto/create-sub-module.dto';

@ApiBearerAuth()
@ApiTags('Sub Modules')
@Roles(ROLES.SUPER_ADMIN)
@Controller({
  path: 'sub-modules',
  version: '1',
})
export class SubModulesController {
  constructor(
    private readonly subModulesService: SubModulesService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateSubModuleDto,
  ) {
    return this.subModulesService.create(dto);
  }

  @Get()
  findAll()
  {
    return this.subModulesService.findAll();
  }

  @Get(':id')
  findOne(
    @Param('id') id: number,
  ) {
    return this.subModulesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: number,
    @Body() dto: UpdateSubModuleDto,
  ) {
    return this.subModulesService.update(
      id,
      dto,
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: number,
  ) {
    return this.subModulesService.remove(id);
  }
}