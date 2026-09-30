import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { BillRunService } from './bill-run.service';
import {
  BillRunQueryDto,
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
  constructor(private readonly billRuns: BillRunService) {}

  @Get('validation/:propertyId')
  @Permission('BILL_RUN_VIEW')
  @ApiOperation({ summary: "Live pre-bill validation checks for a property, computed from Billing Readiness's own real data" })
  @ApiParam({ name: 'propertyId', type: Number })
  getValidation(@Param('propertyId', ParseIntPipe) propertyId: number) {
    return this.billRuns.getValidationChecks(propertyId);
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
