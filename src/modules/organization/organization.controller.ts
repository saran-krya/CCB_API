import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../../common/constants/global';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrganizationService } from './organization.service';
import { SubscriptionPlanService } from './subscription-plan.service';
import {
  AssignSubscriptionDto,
  CreateOrganizationDto,
  OrganizationQueryDto,
  UpdateOrganizationDto,
  UpdateOrganizationStatusDto,
} from './dto/create-organization.dto';
import { CreateSubscriptionPlanDto, UpdateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';

/**
 * Platform Administration — CCB Platform SUPER_ADMIN only. Every route here is `@Roles(SUPER_ADMIN)`,
 * the same pattern Settings' own `system` routes already use for a platform-level (not
 * organization-level) concern: a permission code could be delegated to any role, and creating/managing
 * tenants themselves is SUPER_ADMIN's alone, never something an organization-scoped Policy could grant.
 */
@ApiBearerAuth()
@ApiTags('Platform Administration — Organizations')
@Controller({ path: 'platform/organizations', version: '1' })
export class OrganizationController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly subscriptionPlans: SubscriptionPlanService,
  ) {}

  @Post()
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new organization (tenant)' })
  create(@Body() dto: CreateOrganizationDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.organizations.create(dto, user?.sub);
  }

  @Get()
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'List organizations with pagination, search and status filter' })
  findAll(@Query() query: OrganizationQueryDto) {
    return this.organizations.findAll(query);
  }

  @Get('subscription-plans/all')
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'List the subscription-plan catalog' })
  findAllPlans() {
    return this.subscriptionPlans.findAll();
  }

  @Post('subscription-plans')
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a subscription plan' })
  createPlan(@Body() dto: CreateSubscriptionPlanDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.subscriptionPlans.create(dto, user?.sub);
  }

  @Patch('subscription-plans/:planId')
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a subscription plan' })
  @ApiParam({ name: 'planId', type: Number })
  updatePlan(
    @Param('planId', ParseIntPipe) planId: number,
    @Body() dto: UpdateSubscriptionPlanDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.subscriptionPlans.update(planId, dto, user?.sub);
  }

  @Get(':id')
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Organization detail' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.organizations.findOne(id);
  }

  @Patch(':id')
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update organization information (never its status or subscription — use the dedicated routes)' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.organizations.update(id, dto, user?.sub);
  }

  @Patch(':id/status')
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Activate, suspend, reactivate or deactivate an organization (validated transitions)' })
  @ApiParam({ name: 'id', type: Number })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrganizationStatusDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.organizations.updateStatus(id, dto, user?.sub);
  }

  @Patch(':id/subscription')
  @Roles(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Assign, renew or change an organization\'s subscription plan' })
  @ApiParam({ name: 'id', type: Number })
  assignSubscription(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignSubscriptionDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.organizations.assignSubscription(id, dto, user?.sub);
  }
}
