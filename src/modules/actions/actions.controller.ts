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
import { ActionsService } from './actions.service';

import {
  CreateActionDto,
  UpdateActionDto,
} from './dto/create-action.dto';

@ApiBearerAuth()
@ApiTags('Actions')
@Roles(ROLES.SUPER_ADMIN)
@Controller({
  path: 'actions',
  version: '1',
})
export class ActionsController {
  constructor(
    private readonly actionsService: ActionsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateActionDto,
  ) {
    return this.actionsService.create(dto);
  }

  @Get()
  findAll(
  ) {
    return this.actionsService.findAll();
  }

  @Get(':id')
  findOne(
    @Param('id') id: number,
  ) {
    return this.actionsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: number,
    @Body() dto: UpdateActionDto,
  ) {
    return this.actionsService.update(
      id,
      dto,
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: number,
  ) {
    return this.actionsService.remove(id);
  }
}