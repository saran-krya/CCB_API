import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ROLES } from '@app/common/constants/global';
import { IamService } from './iam.service';
import { CreatePolicyDto, UpdatePolicyDto, AttachPolicyDto } from './dto/policy.dto';
import { RolePoliciesQueryDto } from './dto/role-policies-query.dto';
import { PolicyListQueryDto } from './dto/policy-list-query.dto';
import { PolicyAttachedRolesQueryDto } from './dto/policy-attached-roles-query.dto';
import { PolicyQueryService } from './policy-query.service';

/**
 * Policy administration is restricted to SUPER_ADMIN, same as the existing role-permissions/actions/
 * pmodules/screens/sub-modules controllers — a Policy IS "what a role can do," so managing Policies
 * is exactly as privilege-escalation-sensitive as managing RolePermission grants directly, and gets
 * the identical, unchanged security boundary. @Permission is intentionally NOT added here (unlike
 * role.controller.ts's fix this session) — there is no bootstrapped "who may manage policies" Action
 * code, and inventing one would itself need to be SUPER_ADMIN-exclusive to avoid a role granting
 * itself policy-authoring rights, which @Roles(SUPER_ADMIN) already guarantees more simply.
 */
@ApiBearerAuth()
@ApiTags('IAM Policies')
@Roles(ROLES.SUPER_ADMIN)
@Controller({ path: 'iam/policies', version: '1' })
export class PolicyController {
  constructor(
    private readonly iam: IamService,
    private readonly policyQuery: PolicyQueryService,
  ) {}

  @Get()
  findAll() {
    return this.iam.findAllPolicies();
  }

  // The searchable / filterable / sortable / paged list behind the Policies page and the policy combobox.
  // A literal segment, registered before ':id' like role-counts below.
  @Get('list')
  list(@Query() query: PolicyListQueryDto) {
    return this.policyQuery.list(query);
  }

  // Registered before ':id' — a literal segment must come first or Nest would try to match
  // "role-counts" against :id (ParseIntPipe would then 400 it instead of routing here).
  @Get('role-counts')
  getPolicyCountsByRole() {
    return this.iam.getPolicyCountsByRole();
  }

  // Same ordering requirement as role-counts above — mirror direction (per-POLICY count of
  // attached roles), used by the Policies list's "Attached roles" column.
  @Get('attached-role-counts')
  getRoleCountsByPolicy() {
    return this.iam.getRoleCountsByPolicy();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.iam.findOnePolicy(id);
  }

  // "roles/list" sits before ':id/roles' so the two never read as one another.
  @Get(':id/roles/list')
  findAttachedRolesPage(@Param('id', ParseIntPipe) id: number, @Query() query: PolicyAttachedRolesQueryDto) {
    return this.policyQuery.attachedRoles(id, query);
  }

  @Get(':id/roles')
  findAttachedRoles(@Param('id', ParseIntPipe) id: number) {
    return this.iam.getRolesForPolicy(id);
  }

  @Post()
  create(@Body() dto: CreatePolicyDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.iam.createPolicy(dto, user?.sub);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePolicyDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.iam.updatePolicy(id, dto, user?.sub);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthenticatedUser) {
    return this.iam.removePolicy(id, user?.sub);
  }
}

/**
 * Role <-> Policy attachment, kept as its own controller (not added to role.controller.ts) so
 * RoleModule never needs to import IamModule — IamService depends on Role (to validate a roleId
 * exists) but RoleModule/RoleController have zero dependency back onto Iam, avoiding any circular
 * import between the two. Same SUPER_ADMIN-only boundary as PolicyController above, for the same
 * reason: attaching a Policy to a Role is equivalent in sensitivity to granting RolePermission rows
 * directly.
 */
@ApiBearerAuth()
@ApiTags('IAM Role Policies')
@Roles(ROLES.SUPER_ADMIN)
@Controller({ path: 'roles/:roleId/policies', version: '1' })
export class RolePolicyController {
  constructor(private readonly iam: IamService) {}

  // A literal segment, declared before anything keyed by :policyId.
  @Get('list')
  findAttachedPage(@Param('roleId', ParseIntPipe) roleId: number, @Query() query: RolePoliciesQueryDto) {
    return this.iam.getPoliciesForRolePage(roleId, query);
  }

  @Get()
  findAttached(@Param('roleId', ParseIntPipe) roleId: number) {
    return this.iam.getPoliciesForRole(roleId);
  }

  @Post()
  attach(@Param('roleId', ParseIntPipe) roleId: number, @Body() dto: AttachPolicyDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.iam.attachPolicyToRole(roleId, dto.policyId, user?.sub);
  }

  @Delete(':policyId')
  detach(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Param('policyId', ParseIntPipe) policyId: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.iam.detachPolicyFromRole(roleId, policyId, user?.sub);
  }
}
