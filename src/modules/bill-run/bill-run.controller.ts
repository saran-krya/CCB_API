import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { BillingReadinessService } from '../billing-readiness/billing-readiness.service';
import { BillRunService } from './bill-run.service';
import {
  BillRunQueryDto,
  PastBillingOverviewQueryDto,
  RejectBillRunDto,
  ResubmitBillRunDto,
  ReturnBillRunDto,
  ReviewBillRunDto,
  SubmitBatchBillRunDto,
  SubmitBillRunDto,
} from './dto/bill-run.dto';

@ApiBearerAuth()
@ApiTags('Bill Run')
@Controller({ path: 'bill-runs', version: '1' })
export class BillRunController {
  constructor(
    private readonly billRuns: BillRunService,
    private readonly billingReadiness: BillingReadinessService,
  ) {}

  @Get('validation/:propertyId')
  @Permission('BILL_RUN_VIEW')
  @ApiOperation({ summary: "Live pre-bill validation checks for a property, computed from Billing Readiness's own real data" })
  @ApiParam({ name: 'propertyId', type: Number })
  getValidation(@Param('propertyId', ParseIntPipe) propertyId: number) {
    return this.billRuns.getValidationChecks(propertyId);
  }

  // Same BILL_RUN_VIEW gate as the routine validation check above — this is a read-only eligibility
  // REPORT, not a submission capability, so it needs no new permission code of its own. Missed
  // Reading Recovery: given a property and a specific past reading date, resolves which billing-
  // cycle version/period that date belongs to and reports whether it's eligible for billing —
  // exactly the same check submit() re-runs server-side when readingDate is supplied, surfaced here
  // so the caller can preview the result (and show WHY it's blocked) before attempting submission.
  @Get('recovery-eligibility/:propertyId')
  @Permission('BILL_RUN_VIEW')
  @ApiOperation({ summary: 'Missed Reading Recovery: resolve a past reading date to its billing-cycle version/period and report eligibility for billing — read-only, never creates a bill run' })
  @ApiParam({ name: 'propertyId', type: Number })
  @ApiQuery({ name: 'readingDate', type: String, description: 'A past reading date, e.g. "2026-09-28"' })
  getRecoveryEligibility(@Param('propertyId', ParseIntPipe) propertyId: number, @Query('readingDate') readingDate: string) {
    return this.billingReadiness.checkRecoveredReadingEligibility(propertyId, readingDate);
  }

  // Global Past Billing Overview — same BILL_RUN_VIEW gate as every other read-only check on this
  // controller; this is a report, not a new capability, so it needs no permission code of its own.
  // Estate-wide: every (property, missed historical cycle version) pair, real backend data only.
  @Get('past-billing-overview/summary')
  @Permission('BILL_RUN_VIEW')
  @ApiOperation({ summary: 'Global Past Billing Overview — real, unpaginated summary counts (missing/blocked/pending/approved), scoped by the same filters as the list below' })
  getPastBillingOverviewSummary(@Query() query: PastBillingOverviewQueryDto) {
    return this.billRuns.getPastBillingOverviewSummary(query);
  }

  @Get('past-billing-overview')
  @Permission('BILL_RUN_VIEW')
  @ApiOperation({ summary: 'Global Past Billing Overview — one row per (property, historical cycle version) across the whole estate, paginated and filterable. Never derivable from BillRun rows alone: a missing period has no BillRun to query in the first place.' })
  getPastBillingOverview(@Query() query: PastBillingOverviewQueryDto) {
    return this.billRuns.getPastBillingOverview(query);
  }

  @Get()
  @Permission('BILL_RUN_VIEW')
  @ApiOperation({ summary: 'List bill runs (the Bill Run Requests register), paginated and filterable' })
  findAll(@Query() query: BillRunQueryDto) {
    return this.billRuns.findAll(query);
  }

  @Get('batch/:batchId')
  @Permission('BILL_RUN_VIEW')
  @ApiOperation({ summary: 'Get a batch and every bill run submitted within it' })
  @ApiParam({ name: 'batchId', type: Number })
  getBatch(@Param('batchId', ParseIntPipe) batchId: number) {
    return this.billRuns.getBatchSummary(batchId);
  }

  @Get(':id')
  @Permission('BILL_RUN_VIEW')
  @ApiOperation({ summary: 'Get one bill run by id' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.billRuns.findOne(id);
  }

  // Read-only — sourced entirely from existing AuditLog rows this service already writes on every
  // submit/approve/reject/return/resubmit action; see BillRunService.getApprovalHistory's own doc
  // comment. Not a live re-check of anything, never fabricated.
  @Get(':id/history')
  @Permission('BILL_RUN_VIEW')
  @ApiOperation({ summary: 'Real, multi-event approval-history timeline for one bill run, sourced from its existing audit log entries' })
  @ApiParam({ name: 'id', type: Number })
  getApprovalHistory(@Param('id', ParseIntPipe) id: number) {
    return this.billRuns.getApprovalHistory(id);
  }

  @Post()
  @Permission('BILL_RUN_SUBMIT')
  @ApiOperation({ summary: 'Submit a bill run for one property — blocked unless the property is Ready and has no active bill run for this cycle' })
  submit(@Body() dto: SubmitBillRunDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.billRuns.submit(dto, user?.sub);
  }

  @Post('batch')
  @Permission('BILL_RUN_SUBMIT')
  @ApiOperation({ summary: 'Submit bill runs for multiple properties together as one batch — each property is independently re-validated' })
  submitBatch(@Body() dto: SubmitBatchBillRunDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.billRuns.submitBatch(dto, user?.sub);
  }

  @Patch(':id/resubmit')
  @Permission('BILL_RUN_SUBMIT')
  @ApiOperation({ summary: 'Correct and resubmit a returned or rejected bill run as a new, re-validated submission' })
  @ApiParam({ name: 'id', type: Number })
  resubmit(@Param('id', ParseIntPipe) id: number, @Body() dto: ResubmitBillRunDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.billRuns.resubmit(id, dto, user?.sub);
  }

  @Patch(':id/approve')
  @Permission('BILL_RUN_APPROVE')
  @ApiOperation({ summary: 'Approve a pending bill run (Finance)' })
  @ApiParam({ name: 'id', type: Number })
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewBillRunDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.billRuns.approve(id, dto, user?.sub);
  }

  @Patch(':id/reject')
  @Permission('BILL_RUN_APPROVE')
  @ApiOperation({ summary: 'Reject a pending bill run (Finance)' })
  @ApiParam({ name: 'id', type: Number })
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectBillRunDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.billRuns.reject(id, dto, user?.sub);
  }

  @Patch(':id/return')
  @Permission('BILL_RUN_APPROVE')
  @ApiOperation({ summary: 'Return a pending bill run to Operations for correction (Finance)' })
  @ApiParam({ name: 'id', type: Number })
  returnForCorrection(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnBillRunDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.billRuns.returnForCorrection(id, dto, user?.sub);
  }
}
