import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ROLES } from '@app/common/constants/global';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/policy.dto';
import { UserInlinePolicyService } from './user-inline-policy.service';

/**
 * Inline policies are restricted to SUPER_ADMIN, exactly like PolicyController and RolePolicyController:
 * an inline policy IS "what this user can do", so authoring one is as privilege-escalation-sensitive as
 * authoring a shared Policy — and gets the identical, unchanged boundary. The remaining rules (not on
 * your own account, statements validated against the real catalog) live in UserInlinePolicyService.
 */
@ApiBearerAuth()
@ApiTags('IAM User Inline Policies')
@Roles(ROLES.SUPER_ADMIN)
@Controller({ path: 'users/:userId/inline-policies', version: '1' })
export class UserInlinePolicyController {
  constructor(private readonly inlinePolicies: UserInlinePolicyService) {}

  @Get()
  @ApiOperation({ summary: "A user's own inline policies, each with its statements (resource + action codes)." })
  findAll(@Param('userId', ParseIntPipe) userId: number) {
    return this.inlinePolicies.findAllForUser(userId);
  }

  @Post()
  @ApiOperation({
    summary:
      "Creates an inline policy for ONE user. Its grants are enforced immediately, in addition to what the user's roles grant.",
  })
  create(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: CreatePolicyDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.inlinePolicies.create(userId, dto, user?.sub);
  }

  @Get(':policyId')
  @ApiOperation({ summary: "One of the user's inline policies, with its statements (resource + action codes)." })
  findOne(@Param('userId', ParseIntPipe) userId: number, @Param('policyId', ParseIntPipe) policyId: number) {
    return this.inlinePolicies.findOne(userId, policyId);
  }

  @Patch(':policyId')
  @ApiOperation({
    summary:
      "Edits one of the user's inline policies (name, description and the full statement list). The new grants are enforced on the user's next request.",
  })
  update(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('policyId', ParseIntPipe) policyId: number,
    @Body() dto: UpdatePolicyDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.inlinePolicies.update(userId, policyId, dto, user?.sub);
  }

  @Delete(':policyId')
  @ApiOperation({ summary: "Deletes one of the user's inline policies — its grants stop applying on their next request." })
  remove(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('policyId', ParseIntPipe) policyId: number,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.inlinePolicies.remove(userId, policyId, user?.sub);
  }
}
