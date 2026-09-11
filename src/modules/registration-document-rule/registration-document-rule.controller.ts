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
import { Permission } from '../../common/decorators/permission.decorator';
import {
  ApplicableDocumentRuleQueryDto,
  CreateRegistrationDocumentRuleDto,
  RegistrationDocumentRuleQueryDto,
  UpdateRegistrationDocumentRuleDto,
} from './dto/registration-document-rule.dto';
import { RegistrationDocumentRuleService } from './registration-document-rule.service';

@ApiBearerAuth()
@ApiTags('Registration Document Rules')
@Controller({ path: 'registration-document-rules', version: '1' })
export class RegistrationDocumentRuleController {
  constructor(private readonly rules: RegistrationDocumentRuleService) {}

  @Post()
  @Permission('EDIT_REGISTRATION_DOCUMENT_RULES')
  @ApiOperation({ summary: 'Create a registration document rule' })
  create(
    @Body() dto: CreateRegistrationDocumentRuleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.rules.create(dto, user?.sub);
  }

  @Get()
  @Permission('VIEW_REGISTRATION_DOCUMENT_RULES')
  @ApiOperation({ summary: 'List registration document rules' })
  findAll(@Query() query: RegistrationDocumentRuleQueryDto) {
    return this.rules.findAll(query);
  }

  @Get('applicable')
  @Permission('VIEW_REGISTRATION_DOCUMENT_RULES', 'VIEW_REGISTRATION_REQUESTS', 'CREATE_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Resolve the applicable document rules for a resident/account/contact-type profile' })
  getApplicable(@Query() query: ApplicableDocumentRuleQueryDto) {
    return this.rules.getApplicableRules(query);
  }

  @Get(':id')
  @Permission('VIEW_REGISTRATION_DOCUMENT_RULES')
  @ApiOperation({ summary: 'Get a registration document rule' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.rules.findOne(id);
  }

  @Patch(':id')
  @Permission('EDIT_REGISTRATION_DOCUMENT_RULES')
  @ApiOperation({ summary: 'Update a registration document rule' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRegistrationDocumentRuleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.rules.update(id, dto, user?.sub);
  }

  @Delete(':id')
  @Permission('EDIT_REGISTRATION_DOCUMENT_RULES')
  @ApiOperation({ summary: 'Soft-delete a registration document rule' })
  @ApiParam({ name: 'id', type: Number })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.rules.remove(id, user?.sub);
  }
}
