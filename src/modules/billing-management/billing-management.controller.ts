import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/decorators/permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { BillingManagementService } from './billing-management.service';
import { BillQueryDto, CancelBillDto } from './dto/billing-management.dto';

// This controller never creates, approves, or rejects a Bill Run — that entire workflow stays
// exclusively in bill-run.controller.ts (Bill Run Request / Bill Run Register). generateBillsForBillRun
// is called internally by BillRunService.approve() (see bill-run.service.ts), not exposed as a public
// route — there is no manual "Generate Bills" action anywhere in this controller, matching the
// confirmed design decision that generation is a consequence of Bill Run approval, not a standalone
// trigger. There is likewise no manual "Issue" endpoint — a generated Bill is issued at generation
// time (see BillingManagementService.generateOneBill's own comment) since there is no separate
// review/issue gate in this architecture. This controller's own frontend page (Bill Register,
// formerly at /billing/register) has been decommissioned — findAll/getSummary/findOne/cancel remain
// as real, RBAC-gated backend capabilities for a future customer/invoice-facing screen to reuse.
@ApiBearerAuth()
@ApiTags('Billing Management')
@Controller({ path: 'billing/bills', version: '1' })
export class BillingManagementController {
  constructor(private readonly billingManagement: BillingManagementService) {}

  @Get()
  @Permission('BILLING_VIEW')
  @ApiOperation({ summary: 'Paginated, filtered list of generated Bills' })
  findAll(@Query() query: BillQueryDto) {
    return this.billingManagement.findAll(query);
  }

  @Get('summary')
  @Permission('BILLING_VIEW')
  @ApiOperation({ summary: 'Real backend aggregation — total bills, per-status counts, total billed amount, overdue count' })
  getSummary(@Query() query: BillQueryDto) {
    return this.billingManagement.getSummary(query);
  }

  @Get(':id')
  @Permission('BILLING_VIEW')
  @ApiOperation({ summary: 'Bill detail, including line items' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.billingManagement.findOne(id);
  }

  @Post(':id/cancel')
  @Permission('BILLING_CANCEL')
  @ApiOperation({ summary: 'Cancel a Bill' })
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelBillDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.billingManagement.cancelBill(id, dto, user?.sub);
  }
}
