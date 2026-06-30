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

import {
  CreateScreenDto,
  UpdateScreenDto,
} from './dto/create-screen.dto';
import { ScreensService } from './screens.service';

@ApiBearerAuth()
@ApiTags('Screens')
@Roles(ROLES.SUPER_ADMIN)
@Controller({
  path: 'screens',
  version: '1',
})
export class ScreensController {
  constructor(
    private readonly screensService: ScreensService,
  ) { }

  @Post()
  create(
    @Body() dto: CreateScreenDto,
  ) {
    return this.screensService.create(dto);
  }

  @Get()
  findAll() {
    return this.screensService.findAll();
  }

  @Get(':id')
  findOne(
    @Param('id') id: number,
  ) {
    return this.screensService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: number,
    @Body() dto: UpdateScreenDto,
  ) {
    return this.screensService.update(
      id,
      dto,
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: number,
  ) {
    return this.screensService.remove(id);
  }
}