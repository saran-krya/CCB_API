import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { UpdateApprovalLevelsDto } from './dto/approval-level.dto';
import { SetApproversDto } from './dto/set-approvers.dto';
import { WorkflowType } from './dto/workflow.dto';
import { WorkflowService } from './workflow.service';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowOrchestrationService } from './workflow-orchestration.service';

// Matches CCB_Template's Business Admin -> Workflow Management -> Approval Workflows tab exactly:
// a rail of processes (Tariff, Bill Run, Billing Cycle) and, per process, the real approval
// flow/levels. See WorkflowService's own doc comment for the real-RBAC-grant routes (unchanged),
// and WorkflowDefinitionService/WorkflowOrchestrationService's own doc comments for the real
// orchestration engine this controller also exposes (versioned definitions + live instances).
@ApiBearerAuth()
@ApiTags('Workflow')
@Controller({ path: 'workflow', version: '1' })
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly definitions: WorkflowDefinitionService,
    private readonly orchestration: WorkflowOrchestrationService,
  ) {}

  @Get('approval-flow/:workflowType')
  @Permission('WORKFLOW_VIEW')
  @ApiOperation({ summary: 'The real, single-step approval flow for a workflow type (real approver roles, no SLA/escalation — neither exists in this codebase)' })
  @ApiParam({ name: 'workflowType', enum: WorkflowType })
  getApprovalFlow(@Param('workflowType') workflowType: WorkflowType) {
    return this.workflow.getApprovalFlow(workflowType);
  }

  @Put('approval-flow/:workflowType/approvers')
  @Permission('WORKFLOW_MANAGE_APPROVERS')
  @ApiOperation({ summary: 'Sets the complete list of roles that may approve this workflow type — a real RBAC write, excluded from the SUPER_ADMIN/ADMIN auto-grant (requires an explicit grant, see ADMIN_GRANT_EXCLUDED_ACTION_CODES)' })
  @ApiParam({ name: 'workflowType', enum: WorkflowType })
  setApprovers(@Param('workflowType') workflowType: WorkflowType, @Body() dto: SetApproversDto) {
    return this.workflow.setApprovers(workflowType, dto.roleIds);
  }

  @Get('approval-policy/:workflowType')
  @Permission('WORKFLOW_VIEW')
  @ApiOperation({ summary: '[LEGACY — superseded by GET definitions/:workflowType] The old advisory approval POLICY — kept read-only for back-compat, not written to by any current UI' })
  @ApiParam({ name: 'workflowType', enum: WorkflowType })
  getApprovalPolicy(@Param('workflowType') workflowType: WorkflowType) {
    return this.workflow.getApprovalPolicy(workflowType);
  }

  @Put('approval-policy/:workflowType')
  @Permission('WORKFLOW_MANAGE_APPROVERS')
  @ApiOperation({ summary: '[LEGACY — superseded by PUT definitions/:workflowType] Replaces the old advisory approval POLICY — writes nothing to role_permissions, and no longer drives anything' })
  @ApiParam({ name: 'workflowType', enum: WorkflowType })
  updateApprovalPolicy(@Param('workflowType') workflowType: WorkflowType, @Body() dto: UpdateApprovalLevelsDto) {
    return this.workflow.updateApprovalPolicy(workflowType, dto);
  }

  @Get('definitions/:workflowType')
  @Permission('WORKFLOW_VIEW')
  @ApiOperation({ summary: 'The current ACTIVE workflow definition (versioned, enforced) for a workflow type' })
  @ApiParam({ name: 'workflowType', enum: WorkflowType })
  getActiveDefinition(@Param('workflowType') workflowType: WorkflowType) {
    return this.definitions.getActiveDefinition(workflowType);
  }

  @Get('definitions/:workflowType/eligible-approver-roles')
  @Permission('WORKFLOW_VIEW')
  @ApiOperation({ summary: 'Roles currently eligible to be configured as an approver for this workflow type — i.e. roles that CURRENTLY hold the real domain approve permission. Same predicate publishDefinition enforces at save time; backs the Approver Role dropdown so it never shows an ineligible role.' })
  @ApiParam({ name: 'workflowType', enum: WorkflowType })
  getEligibleApproverRoles(@Param('workflowType') workflowType: WorkflowType) {
    return this.definitions.getEligibleApproverRoles(workflowType);
  }

  @Get('definitions/:workflowType/history')
  @Permission('WORKFLOW_VIEW')
  @ApiOperation({ summary: 'Every version ever published for a workflow type, newest first' })
  @ApiParam({ name: 'workflowType', enum: WorkflowType })
  getDefinitionHistory(@Param('workflowType') workflowType: WorkflowType) {
    return this.definitions.getDefinitionHistory(workflowType);
  }

  @Put('definitions/:workflowType')
  @Permission('WORKFLOW_MANAGE_APPROVERS')
  @ApiOperation({ summary: 'Publishes a NEW version of the workflow definition — never mutates a prior version; in-flight instances keep using the version they started under' })
  @ApiParam({ name: 'workflowType', enum: WorkflowType })
  publishDefinition(
    @Param('workflowType') workflowType: WorkflowType,
    @Body() dto: UpdateApprovalLevelsDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.definitions.publishNewVersion(workflowType, dto, user?.sub);
  }

  // NOTE: deliberately NO @Permission('WORKFLOW_VIEW') on these two runtime routes — that
  // permission gates workflow CONFIGURATION (the routes above this comment: definitions/
  // approval-flow/approval-policy), a different question from "can this user see where THIS
  // business record's approval currently stands." Authorization here is instead
  // assertCanViewRuntime's own domain-action-code check (TARIFF_VIEW/BILL_RUN_VIEW/
  // VIEW_BILLING_CYCLE or that type's approve code — see RUNTIME_VIEW_ACTION_CODES's own doc
  // comment) — still a real, enforced 403 for an unauthorized user, just not the generic
  // workflow-config permission. The route still requires a valid authenticated session: JwtAuthGuard
  // is a separate global guard applied regardless of @Permission.
  @Get('instances/:workflowType/:businessObjectId')
  @ApiOperation({ summary: "The live/most-recent workflow instance for one business object — current level, SLA status, full step history. Authorized by the caller's real domain view/approve access for that workflowType, not WORKFLOW_VIEW." })
  @ApiParam({ name: 'workflowType', enum: WorkflowType })
  @ApiParam({ name: 'businessObjectId', type: Number })
  async getInstance(
    @Param('workflowType') workflowType: WorkflowType,
    @Param('businessObjectId') businessObjectId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    await this.orchestration.assertCanViewRuntime(workflowType, user?.sub);
    return this.orchestration.getInstanceView(workflowType, Number(businessObjectId));
  }

  @Get('instances/:workflowType')
  @ApiOperation({ summary: "Every in-flight (WAITING_FOR_APPROVAL) instance for a workflow type — read-only queue visibility, no action lives here. Authorized by the caller's real domain view/approve access for that workflowType, not WORKFLOW_VIEW." })
  @ApiParam({ name: 'workflowType', enum: WorkflowType })
  async listInFlightInstances(@Param('workflowType') workflowType: WorkflowType, @CurrentUser() user?: AuthenticatedUser) {
    await this.orchestration.assertCanViewRuntime(workflowType, user?.sub);
    return this.orchestration.listInFlightInstances(workflowType);
  }
}
