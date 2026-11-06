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
import { Permission } from '../../common/decorators/permission.decorator';
import { CommunityService } from './community.service';
import {
  CommunityQueryDto,
  CreateCommunityDto,
  UpdateCommunityDto,
  UpdateCommunityStatusDto,
} from './dto/create-community.dto';
import { CommunityDetailDto, CommunityListDto } from './dto/community-response.dto';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';

@ApiBearerAuth()
@ApiTags('Communities')
@Controller({ path: 'communities', version: '1' })
export class CommunityController {
  constructor(private readonly communities: CommunityService) {}

  @Post()
  @Permission(ACTION_CODES.CREATE_COMMUNITY)
  @ApiOperation({ summary: 'Create a community' })
  create(
    @Body() dto: CreateCommunityDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.communities.create(dto, user?.sub);
  }

  @Get('stats')
  @Permission(ACTION_CODES.VIEW_COMMUNITY)
  @ApiOperation({ summary: 'Get global community stats' })
  getStats() {
    return this.communities.getStats();
  }

  // Also CREATE_REGISTRATION_REQUEST/EDIT_REGISTRATION_REQUEST and TARIFF_CREATE/TARIFF_EDIT:
  // Registration creation's unit-selection step and Tariff creation's applicability picker both
  // read this list as reference data to let the user pick a community, not to manage Community as
  // a module. Does NOT grant create/edit/delete (still CREATE_COMMUNITY/EDIT_COMMUNITY/
  // DELETE_COMMUNITY only) — mirrors the same OR-list pattern already used by Property/Unit's
  // GET :id routes for exactly this "read-only cross-module support" case.
  @Get()
  @Permission(ACTION_CODES.VIEW_COMMUNITY, ACTION_CODES.CREATE_REGISTRATION_REQUEST, ACTION_CODES.EDIT_REGISTRATION_REQUEST, ACTION_CODES.TARIFF_CREATE, ACTION_CODES.TARIFF_EDIT)
  @ApiOperation({ summary: 'List all communities with pagination and filters' })
  @ApiOkResponse({ type: CommunityListDto, isArray: true, description: 'Paginated list of communities' })
  findAll(@Query() query: CommunityQueryDto) {
    return this.communities.findAll(query);
  }

  @Get(':id')
  @Permission(ACTION_CODES.VIEW_COMMUNITY)
  @ApiOperation({ summary: 'Get community detail with stats and properties' })
  @ApiOkResponse({ type: CommunityDetailDto })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.communities.findOne(id);
  }

  @Patch(':id')
  @Permission(ACTION_CODES.EDIT_COMMUNITY)
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
  @Permission(ACTION_CODES.COMMUNITY_STATUS)
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
  @Permission(ACTION_CODES.DELETE_COMMUNITY)
  @ApiOperation({ summary: 'Soft-delete a community' })
  @ApiParam({ name: 'id', type: Number })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.communities.remove(id, user?.sub);
  }
}
