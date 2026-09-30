import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../../audit/audit.module';
import { TariffModule } from '../tariff/tariff.module';
import { CustomerModule } from '../customer/customer.module';
import { Bill } from './entities/bill.entity';
import { BillLineItem } from './entities/bill-line-item.entity';
import { BillRun } from '../bill-run/entities/bill-run.entity';
import { Unit } from '../unit/entities/unit.entity';
import { MeterReading } from '../sftp/entities/meter-reading.entity';
import { TariffTier } from '../tariff/entities/tariff-tier.entity';
import { BillingManagementController } from './billing-management.controller';
import { BillingManagementService } from './billing-management.service';

// Deliberately does NOT import BillRunModule — the dependency runs the other direction (BillRun
// module will import THIS module to call generateBillsForBillRun() from within its own approve()
// method), avoiding a circular import. This module only needs the BillRun ENTITY (read/lock access
// via TypeOrmModule.forFeature), never BillRunService itself.
@Module({
  imports: [
    TypeOrmModule.forFeature([Bill, BillLineItem, BillRun, Unit, MeterReading, TariffTier]),
    TariffModule,
    CustomerModule,
    AuditModule,
  ],
  controllers: [BillingManagementController],
  providers: [BillingManagementService],
  exports: [BillingManagementService],
})
export class BillingManagementModule {}
