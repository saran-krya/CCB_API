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
@Roles(ROLES.ADMIN, ROLES.OPERATIONS)
@Controller({ path: 'properties', version: '1' })
export class PropertyController {
  constructor(private readonly properties: PropertyService) {}

  @Post()
  @ApiOperation({ summary: 'Create a property' })
  create(
    @Body() dto: CreatePropertyDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.properties.create(dto, user?.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List all properties with pagination and filters' })
  @ApiOkResponse({ type: PropertyListDto, isArray: true, description: 'Paginated list of properties' })
  findAll(@Query() query: PropertyQueryDto) {
    return this.properties.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get property detail with stats and units' })
  @ApiOkResponse({ type: PropertyDetailDto })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.properties.findOne(id);
  }

  @Patch(':id')
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
  @ApiOperation({ summary: 'Soft-delete a property' })
  @ApiParam({ name: 'id', type: Number })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.properties.remove(id, user?.sub);
  }
}
