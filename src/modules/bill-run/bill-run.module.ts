import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingReadinessModule } from '../billing-readiness/billing-readiness.module';
import { BillingCycleModule } from '../billing-cycle/billing-cycle.module';
import { BillingManagementModule } from '../billing-management/billing-management.module';
import { BillingCycleMaster } from '../billing-cycle/entities/billing-cycle-master.entity';
import { Property } from '../property/entities/property.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { User } from '../user/entities/user.entity';
import { WorkflowModule } from '../workflow/workflow.module';
import { BillRun } from './entities/bill-run.entity';
import { BillRunBatch } from './entities/bill-run-batch.entity';
import { BillRunController } from './bill-run.controller';
import { BillRunService } from './bill-run.service';

// Reuses BillingReadinessService.getReadiness() and
// BillingCycleService.getReadingPeriodForProperty() as-is (never re-implementing readiness/cycle
// logic here). Also imports BillingManagementModule — BillRunService.approve() calls
// generateBillsForBillRun() after an approval commits (see bill-run.service.ts's own comment on
// this exact boundary). The dependency runs this direction deliberately, never the reverse —
// BillingManagementModule does NOT import BillRunModule — to avoid a circular import; Billing
// Management only needs the BillRun ENTITY (via its own TypeOrmModule.forFeature), never
// BillRunService itself.
@Module({
  imports: [
    // MeterReading is reused directly (same pattern as BillingManagementModule reusing the BillRun
    // entity above) — only for a read-only "does this property have any out-of-cycle readings on
    // file" check in getValidationChecks' messaging, never for billing calculation itself (that
    // stays exclusively in BillingManagementService.calculateConsumption). User is reused the same
    // way — read-only, batched lookups only, resolving AuditLog.performedBy ids to real names for
    // getApprovalHistory (Period-wise Billing History feature); never writes, never auth-related.
    // BillingCycleMaster is reused the same way again — read-only, estate-wide enumeration of which
    // properties have a billing cycle at all, for getPastBillingOverview (Global Past Billing
    // Overview feature); never writes, cycle-version mutation logic stays exclusively in
    // BillingCycleService/BillingCycleModule.
    TypeOrmModule.forFeature([BillRun, BillRunBatch, Property, MeterReading, User, BillingCycleMaster]),
    BillingReadinessModule,
    BillingCycleModule,
    BillingManagementModule,
    WorkflowModule,
  ],
  controllers: [BillRunController],
  providers: [BillRunService],
  exports: [BillRunService],
})
export class BillRunModule {}
