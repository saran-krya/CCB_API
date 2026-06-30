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
import { CommunityService } from './community.service';
import {
  CommunityQueryDto,
  CreateCommunityDto,
  UpdateCommunityDto,
  UpdateCommunityStatusDto,
} from './dto/create-community.dto';
import { CommunityDetailDto, CommunityListDto } from './dto/community-response.dto';

@ApiBearerAuth()
@ApiTags('Communities')
@Roles(ROLES.ADMIN, ROLES.OPERATIONS)
@Controller({ path: 'communities', version: '1' })
export class CommunityController {
  constructor(private readonly communities: CommunityService) {}

  @Post()
  @ApiOperation({ summary: 'Create a community' })
  create(
    @Body() dto: CreateCommunityDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.communities.create(dto, user?.sub);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get global community stats' })
  getStats() {
    return this.communities.getStats();
  }

  @Get()
  @ApiOperation({ summary: 'List all communities with pagination and filters' })
  @ApiOkResponse({ type: CommunityListDto, isArray: true, description: 'Paginated list of communities' })
  findAll(@Query() query: CommunityQueryDto) {
    return this.communities.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get community detail with stats and properties' })
  @ApiOkResponse({ type: CommunityDetailDto })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.communities.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update community' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCommunityDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.communities.update(id, dto, user?.sub);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update community status' })
  @ApiParam({ name: 'id', type: Number })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCommunityStatusDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.communities.updateStatus(id, dto, user?.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a community' })
  @ApiParam({ name: 'id', type: Number })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.communities.remove(id, user?.sub);
  }
}
