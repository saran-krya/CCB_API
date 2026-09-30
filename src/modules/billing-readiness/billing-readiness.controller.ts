import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/decorators/permission.decorator';
import { BillingReadinessService } from './billing-readiness.service';
import { BillingReadinessQueryDto } from './dto/billing-readiness.dto';

@ApiBearerAuth()
@ApiTags('Billing Readiness')
@Controller({ path: 'billing-readiness', version: '1' })
export class BillingReadinessController {
  constructor(private readonly billingReadiness: BillingReadinessService) {}

  @Get('properties')
  // BILLING_READINESS_VIEW is the single permission for the whole Billing Readiness sub-module —
  // it governs every tab (Dashboard, Property Billing Readiness, Anomaly Review, Readings List) as
  // pure UI navigation, not separate RBAC boundaries. BILLING_READINESS_PROPERTY_VIEW existed as a
  // second, independently-assignable code but was merged into this one on explicit request — see
  // BILLING_READINESS_VIEW's own seed-data comment.
  @Permission('BILLING_READINESS_VIEW')
  @ApiOperation({ summary: 'Live per-property billing readiness (Ready/On Hold/Not Ready), computed on every request — not cached' })
  getProperties(@Query() query: BillingReadinessQueryDto) {
    return this.billingReadiness.getReadiness(query);
  }
}
