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

import { PaginationQueryDto } from '@app/common/dto/pagination-query.dto';

import { UserTypeService } from './user-type.service';
import { CreateUserTypeDto, UpdateUserTypeDto } from './dto/create-user-type.dto';

@ApiBearerAuth()
@ApiTags('User Types')
@Controller({
  path: 'user-types',
  version: '1',
})
export class UserTypeController {
  constructor(
    private readonly userTypeService: UserTypeService,
  ) {}

  @Post()
  create(
    @Body()
    dto: CreateUserTypeDto,
  ) {
    return this.userTypeService.create(
      dto,
    );
  }

  @Get()
  findAll(
    @Query()
    query: PaginationQueryDto,
  ) {
    return this.userTypeService.findAll(
  );
  }

  @Get(':id')
  findOne(
    @Param('id')
    id: number,
  ) {
    return this.userTypeService.findOne(
      id,
    );
  }

  @Patch(':id')
  update(
    @Param('id')
    id: number,

    @Body()
    dto: UpdateUserTypeDto,
  ) {
    return this.userTypeService.update(
      id,
      dto,
    );
  }

  @Delete(':id')
  remove(
    @Param('id')
    id: number,
  ) {
    return this.userTypeService.remove(
      id,
    );
  }
}