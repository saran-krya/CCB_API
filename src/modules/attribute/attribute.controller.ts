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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ROLES } from '../../common/constants/global';
import { AttributeService } from './attribute.service';
import { AttributeQueryDto, CreateAttributeDto, UpdateAttributeDto } from './dto/attribute.dto';

// SUPER_ADMIN + ADMIN (not SUPER_ADMIN-only): UserService.getProfile() grants
// ADMIN full menu access via getAllMenus(), so ADMIN users see this screen in
// their nav with enabled action buttons — locking the API to SUPER_ADMIN-only
// would 403 every one of those calls.
@ApiBearerAuth()
@ApiTags('Attributes')
@Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
@Controller({ path: 'attributes', version: '1' })
export class AttributeController {
  constructor(private readonly attributes: AttributeService) {}

  @Get()
  @ApiOperation({ summary: 'List attributes (system: paginated table; module: full group set)' })
  findAll(@Query() query: AttributeQueryDto) {
    return this.attributes.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get attribute by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.attributes.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom attribute' })
  create(@Body() dto: CreateAttributeDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.attributes.create(dto, user?.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an attribute' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttributeDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.attributes.update(id, dto, user?.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a custom (non-system-defined) attribute' })
  @ApiParam({ name: 'id', type: Number })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.attributes.remove(id, user?.sub);
  }
}
