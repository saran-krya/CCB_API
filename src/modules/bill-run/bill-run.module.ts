import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingReadinessModule } from '../billing-readiness/billing-readiness.module';
import { BillingCycleModule } from '../billing-cycle/billing-cycle.module';
import { BillingManagementModule } from '../billing-management/billing-management.module';
import { Property } from '../property/entities/property.entity';
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
    TypeOrmModule.forFeature([BillRun, BillRunBatch, Property]),
    BillingReadinessModule,
    BillingCycleModule,
    BillingManagementModule,
  ],
  controllers: [BillRunController],
  providers: [BillRunService],
  exports: [BillRunService],
})
export class BillRunModule {}
