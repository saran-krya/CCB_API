import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CommunityService } from './community.service';
import { CreateCommunityDto, UpdateCommunityDto } from './dto/create-community.dto';
import { ROLES } from '@app/common/constants/global';


@ApiBearerAuth()
@ApiTags('Communities')
@Roles(ROLES.ADMIN)
@Controller({ path: 'communities', version: '1' })
export class CommunityController {
  constructor(private readonly communities: CommunityService) { }

  @Post()
  create(
    @Body() dto: CreateCommunityDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.communities.create(dto, user?.sub);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.communities.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.communities.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() dto: UpdateCommunityDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.communities.update(id, dto, user?.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.communities.remove(id, user?.sub);
  }
}
