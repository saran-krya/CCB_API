import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { AttributeService } from './attribute.service';
import { AttributeQueryDto, UpdateAttributeDto } from './dto/attribute.dto';

// Route-level @Permission() — gates business routes by Screen Action
// (ATTRIBUTES screen) instead of hardcoded roles, so access is controlled
// entirely through Role Permissions per role, not role names.
//
// Attributes are developer-defined and seeded — there is no create/delete
// endpoint (CREATE_ATTRIBUTE/DELETE_ATTRIBUTE exist in the seed for a future
// route). Update is gated on EDIT_ATTRIBUTE, but AttributeService enforces a
// finer-grained rule underneath: only SUPER_ADMIN may write scope=system
// (General Attributes) rows; ADMIN is allowed for scope=module (Module
// Attributes) rows. That distinction depends on the attribute's own scope,
// not the route, so it can't be expressed with @Permission() here — it's a
// single inline check in the service, not a parallel authorization
// mechanism, and is untouched by this migration.
@ApiBearerAuth()
@ApiTags('Attributes')
@Controller({ path: 'attributes', version: '1' })
export class AttributeController {
  constructor(private readonly attributes: AttributeService) {}

  @Get()
  @Permission('VIEW_ATTRIBUTE')
  @ApiOperation({ summary: 'List attributes (system: paginated table; module: full group set)' })
  findAll(@Query() query: AttributeQueryDto) {
    return this.attributes.findAll(query);
  }

  @Get(':id')
  @Permission('VIEW_ATTRIBUTE')
  @ApiOperation({ summary: 'Get attribute by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.attributes.findOne(id);
  }

  @Patch(':id')
  @Permission('EDIT_ATTRIBUTE')
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
