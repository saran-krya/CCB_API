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
import {
  CreatePropertyDto,
  PropertyQueryDto,
  UpdatePropertyDto,
  UpdatePropertyStatusDto,
} from './dto/create-property.dto';
import { PropertyDetailDto, PropertyListDto } from './dto/property-response.dto';
import { PropertyService } from './property.service';

// Route-level @Permission() — gates business routes by Screen Action
// (PROPERTY screen) instead of hardcoded roles, so access is controlled
// entirely through Role Permissions per role, not role names.
@ApiBearerAuth()
@ApiTags('Properties')
@Controller({ path: 'properties', version: '1' })
export class PropertyController {
  constructor(private readonly properties: PropertyService) {}

  @Post()
  @Permission('CREATE_PROPERTY')
  @ApiOperation({ summary: 'Create a property' })
  create(
    @Body() dto: CreatePropertyDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.properties.create(dto, user?.sub);
  }

  @Get()
  @Permission('VIEW_PROPERTY')
  @ApiOperation({ summary: 'List all properties with pagination and filters' })
  @ApiOkResponse({ type: PropertyListDto, isArray: true, description: 'Paginated list of properties' })
  findAll(@Query() query: PropertyQueryDto) {
    return this.properties.findAll(query);
  }

  @Get(':id')
  @Permission('VIEW_PROPERTY')
  @ApiOperation({ summary: 'Get property detail with stats and units' })
  @ApiOkResponse({ type: PropertyDetailDto })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.properties.findOne(id);
  }

  @Patch(':id')
  @Permission('EDIT_PROPERTY')
  @ApiOperation({ summary: 'Update property' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePropertyDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.properties.update(id, dto, user?.sub);
  }

  @Patch(':id/status')
  @Permission('PROPERTY_STATUS')
  @ApiOperation({ summary: 'Update property status' })
  @ApiParam({ name: 'id', type: Number })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePropertyStatusDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.properties.updateStatus(id, dto, user?.sub);
  }

  @Delete(':id')
  @Permission('DELETE_PROPERTY')
  @ApiOperation({ summary: 'Soft-delete a property' })
  @ApiParam({ name: 'id', type: Number })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.properties.remove(id, user?.sub);
  }
}
