import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/decorators/permission.decorator';
import { SetApproversDto } from './dto/set-approvers.dto';
import { WorkflowType } from './dto/workflow.dto';
import { WorkflowService } from './workflow.service';

// Matches CCB_Template's Business Admin -> Workflow Management -> Approval Workflows tab exactly:
// a rail of processes (Tariff, Bill Run) and, per process, the real approval flow/levels — no item
// list or item detail (the Template has neither). See WorkflowService's own doc comment.
@ApiBearerAuth()
@ApiTags('Workflow')
@Controller({ path: 'workflow', version: '1' })
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

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
}
