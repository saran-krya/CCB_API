import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { AttributeService } from './attribute.service';
import { AttributeQueryDto, UpdateAttributeDto } from './dto/attribute.dto';

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
