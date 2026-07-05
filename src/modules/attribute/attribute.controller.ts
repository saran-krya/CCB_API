import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ROLES } from '../../common/constants/global';
import { AttributeService } from './attribute.service';
import { AttributeQueryDto, UpdateAttributeDto } from './dto/attribute.dto';

// SUPER_ADMIN + ADMIN (not SUPER_ADMIN-only): UserService.getProfile() grants
// ADMIN full menu access via getAllMenus(), so ADMIN users see this screen in
// their nav with enabled action buttons — locking the API to SUPER_ADMIN-only
// would 403 every one of those calls.
//
// Attributes are developer-defined and seeded — there is no create/delete
// endpoint. Update is also SUPER_ADMIN + ADMIN at the controller level, but
// AttributeService enforces a finer-grained rule underneath: only SUPER_ADMIN
// may write scope=system (General Attributes) rows; ADMIN is allowed for
// scope=module (Module Attributes) rows. That distinction depends on the
// attribute's own scope, not the route, so it can't be expressed with a
// second @Roles() decorator here — it's a single inline check in the service,
// not a parallel authorization mechanism.
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

  @Patch(':id')
  @ApiOperation({ summary: "Update a predefined attribute's value" })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttributeDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.attributes.update(id, dto, user?.sub, user?.roleName);
  }
}
