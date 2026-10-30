import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ROLES } from '@app/common/constants/global';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/policy.dto';
import { RoleInlinePolicyService } from './role-inline-policy.service';

/**
 * Inline policies are restricted to SUPER_ADMIN, exactly like PolicyController, RolePolicyController
 * and UserInlinePolicyController: a role's inline policy IS "what everyone holding that role can do",
 * so authoring one is as privilege-escalation-sensitive as authoring a shared Policy — and gets the
 * identical, unchanged boundary. The remaining rule (never on a role you currently hold yourself) and
 * statement validation against the real catalog live in RoleInlinePolicyService.
 */
@ApiBearerAuth()
@ApiTags('IAM Role Inline Policies')
@Roles(ROLES.SUPER_ADMIN)
@Controller({ path: 'roles/:roleId/inline-policies', version: '1' })
export class RoleInlinePolicyController {
  constructor(private readonly inlinePolicies: RoleInlinePolicyService) {}

  @Get()
  @ApiOperation({ summary: "A role's own inline policies, each with its statements (resource + action codes)." })
  findAll(@Param('roleId', ParseIntPipe) roleId: number) {
    return this.inlinePolicies.findAllForRole(roleId);
  }

  @Post()
  @ApiOperation({
    summary:
      "Creates an inline policy for ONE role. Its grants are enforced immediately for every current holder of the role, in addition to what the role's attached Policies grant.",
  })
  create(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Body() dto: CreatePolicyDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.inlinePolicies.create(roleId, dto, user?.sub);
  }

  @Get(':policyId')
  @ApiOperation({ summary: "One of the role's inline policies, with its statements (resource + action codes)." })
  findOne(@Param('roleId', ParseIntPipe) roleId: number, @Param('policyId', ParseIntPipe) policyId: number) {
    return this.inlinePolicies.findOne(roleId, policyId);
  }

  @Patch(':policyId')
  @ApiOperation({
    summary:
      "Edits one of the role's inline policies (name, description and the full statement list). The new grants are enforced for every holder of the role on their next request.",
  })
  update(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Param('policyId', ParseIntPipe) policyId: number,
    @Body() dto: UpdatePolicyDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.inlinePolicies.update(roleId, policyId, dto, user?.sub);
  }

  @Delete(':policyId')
  @ApiOperation({ summary: "Deletes one of the role's inline policies — its grants stop applying for every holder of the role on their next request." })
  remove(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Param('policyId', ParseIntPipe) policyId: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.inlinePolicies.remove(roleId, policyId, user?.sub);
  }
}
