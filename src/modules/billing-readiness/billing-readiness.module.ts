import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingCycleModule } from '../billing-cycle/billing-cycle.module';
import { TariffModule } from '../tariff/tariff.module';
import { CustomerModule } from '../customer/customer.module';
import { Property } from '../property/entities/property.entity';
import { Unit } from '../unit/entities/unit.entity';
import { SubMeter } from '../meter/entities/sub-meter.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { BillRun } from '../bill-run/entities/bill-run.entity';
import { BillingReadinessController } from './billing-readiness.controller';
import { BillingReadinessService } from './billing-readiness.service';

// A leaf module — only ever consumes BillingCycleService/TariffService/CustomerService, never
// gets called back into by any of them, so no forwardRef is needed anywhere here (verified against
// each of these three modules' own imports/exports before writing this — see the Phase 1
// implementation plan). MeterModule itself is NOT imported here: only its SubMeter/MeterReading
// entities are needed directly via TypeOrmModule.forFeature, avoiding a needless service
// dependency on the whole meter module for two repository-level reads. The BillRun ENTITY is
// reused the same way (not BillRunModule, which itself imports THIS module — importing it back
// would be circular) — only for evaluateHistoricalCycle's existing-run check, never for any
// Bill Run business logic, which stays exclusively in BillRunService.
@Module({
  imports: [
    TypeOrmModule.forFeature([Property, Unit, SubMeter, MeterReading, BillRun]),
    BillingCycleModule,
    TariffModule,
    CustomerModule,
  ],
  controllers: [BillingReadinessController],
  providers: [BillingReadinessService],
  exports: [BillingReadinessService],
})
export class BillingReadinessModule {}
