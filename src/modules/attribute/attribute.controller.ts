import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { AttributeService } from './attribute.service';
import { AttributeQueryDto, UpdateAttributeDto } from './dto/attribute.dto';

@ApiBearerAuth()
@ApiTags('Attributes')
@Controller({ path: 'attributes', version: '1' })
export class AttributeController {
  constructor(private readonly attributes: AttributeService) {}

  // @Authenticated, not @Permission — module attributes are shared read-only config consumed by
  // ordinary feature pages (e.g. the registration wizard's field-requirement/OCR toggles), not just
  // the System Admin attributes screen. Any signed-in staff user can read them; only the write below
  // (update) is permission-gated.
  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'List attributes (system: paginated table; module: full group set)' })
  findAll(@Query() query: AttributeQueryDto) {
    return this.attributes.findAll(query);
  }

  @Get(':id')
  @Authenticated()
  @ApiOperation({ summary: 'Get attribute by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.attributes.findOne(id);
  }

  // @Authenticated, not a single @Permission — most attributes require EDIT_ATTRIBUTE, but
  // OCR_DATA_ENTRY_ENABLED is also editable by anyone with Registration Request create/edit
  // access, so the actual authorization decision (which varies per attribute key) is made inside
  // AttributeService.update (it throws 403 for anyone who holds none of the codes that key allows),
  // not at the route level.
  @Patch(':id')
  @Authenticated()
  @ApiOperation({ summary: "Update a predefined attribute's value" })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttributeDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.attributes.update(id, dto, user?.sub, user?.roleNames, user?.roleIds);
  }
}
