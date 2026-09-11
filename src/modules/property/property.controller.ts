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

  // Also CREATE_REGISTRATION_REQUEST/EDIT_REGISTRATION_REQUEST and TARIFF_CREATE/TARIFF_EDIT: same
  // reasoning as the GET :id route below — Registration creation's unit-selection step and Tariff
  // creation's applicability picker read this list as reference data, not to manage Property as a
  // module. Does NOT grant create/edit/delete.
  @Get()
  @Permission('VIEW_PROPERTY', 'CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST', 'TARIFF_CREATE', 'TARIFF_EDIT')
  @ApiOperation({ summary: 'List all properties with pagination and filters' })
  @ApiOkResponse({ type: PropertyListDto, isArray: true, description: 'Paginated list of properties' })
  findAll(@Query() query: PropertyQueryDto) {
    return this.properties.findAll(query);
  }

  // Also VIEW_COMMUNITY: the Communities feature's own property drill-through page
  // (communities/[id]/properties/[propertyId]) needs this same read-only detail — the Community
  // module already summarizes each property inline on its own GET :id response
  // (CommunityDetailDto.properties), so a Community viewer clicking through to see the full detail
  // is reading data their own feature already anticipates, not managing Property as a module. This
  // does NOT grant create/edit/delete (still CREATE_PROPERTY/EDIT_PROPERTY/DELETE_PROPERTY only) —
  // mirrors the same OR-list pattern already used by registration-request/tariff endpoints for
  // exactly this "read-only cross-module support" case.
  // Also CREATE_REGISTRATION_REQUEST/EDIT_REGISTRATION_REQUEST: Registration creation's
  // usePropertiesByIdsQuery re-fetches each selected unit's property detail by id
  // (RegistrationWizard.tsx) as reference data, not to manage Property as a module. Tariff's
  // applicability picker only calls the LIST endpoint above, never this by-id route, so
  // TARIFF_CREATE/TARIFF_EDIT are deliberately not added here.
  @Get(':id')
  @Permission('VIEW_PROPERTY', 'VIEW_COMMUNITY', 'CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST')
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
