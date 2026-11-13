import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMINISTRATOR_ROLES } from '../../common/security/administrator-roles';
import {
  CreateEmailTemplateDto,
  EmailContentDto,
  EmailTemplateQueryDto,
  SetEmailTemplateActiveDto,
  UpdateEmailSettingsDto,
  UpdateEmailTemplateDto,
} from './dto/email-template.dto';
import { EmailTemplateService } from './email-template.service';

/** Per-IP limit of the two routes that render or send a message on request (on top of the global limit). */
const COMPOSE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const TEST_SEND_LIMIT = { default: { limit: 5, ttl: 60_000 } };

/**
 * E-mail template management. Every route is for the super administrator of this installation only (`@Roles(SUPER_ADMIN)`, the same rule as
 * the other administration-console screens): a template decides what the system says in its name, so it is not a delegable permission. A
 * delegated administrator never reaches any of it.
 */
@ApiBearerAuth()
@ApiTags('Email Templates')
@Roles(...ADMINISTRATOR_ROLES)
@Controller({ path: 'email-templates', version: '1' })
export class EmailTemplateController {
  constructor(private readonly templates: EmailTemplateService) {}

  // The fixed paths are declared above ":id" so they are never read as a template id.

  @Get('meta')
  @ApiOperation({ summary: 'The supported placeholders and languages, the built-in template keys, and whether the HTML sanitizer is installed.' })
  getMeta() {
    return this.templates.getMeta();
  }

  @Get('settings')
  @ApiOperation({ summary: 'The e-mail branding in use: company name (and where it comes from), logo, header and button colours, footer text.' })
  getSettings() {
    return this.templates.getSettings();
  }

  @Put('settings')
  @ApiOperation({
    summary:
      'Saves the e-mail branding (SYSTEM attributes, created on first save). A setting left out is unchanged; an empty or null one goes back to its default. 400 with a message per invalid field.',
  })
  updateSettings(@Body() dto: UpdateEmailSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.updateSettings(dto, user);
  }

  @Post('preview')
  @Throttle(COMPOSE_LIMIT)
  @ApiOperation({ summary: 'Renders the message on screen exactly as it would be sent, with sample values. Nothing is sent or saved.' })
  preview(@Body() dto: EmailContentDto) {
    return this.templates.preview(dto);
  }

  @Post('test-send')
  @Throttle(TEST_SEND_LIMIT)
  @ApiOperation({ summary: "Sends the rendered sample to the signed-in administrator's own address only." })
  sendTest(@Body() dto: EmailContentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.sendTest(dto, user);
  }

  @Get()
  list(@Query() query: EmailTemplateQueryDto) {
    return this.templates.list(query);
  }

  @Post()
  create(@Body() dto: CreateEmailTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.create(dto, user);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.templates.findOne(id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: Number })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmailTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.update(id, dto, user);
  }

  @Patch(':id/active')
  @ApiParam({ name: 'id', type: Number })
  @ApiOperation({ summary: 'Switches a template on or off. A template that is off is ignored when mail is sent: the built-in default is used instead.' })
  setActive(@Param('id', ParseIntPipe) id: number, @Body() dto: SetEmailTemplateActiveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.setActive(id, dto.isActive, user);
  }

  @Post(':id/reset')
  @ApiParam({ name: 'id', type: Number })
  @ApiOperation({ summary: 'Puts a built-in template back to the subject and body it shipped with.' })
  reset(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.resetToDefault(id, user);
  }
}
