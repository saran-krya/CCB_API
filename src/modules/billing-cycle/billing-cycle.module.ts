import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttributeModule } from '../attribute/attribute.module';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { LovModule } from '../lov/lov.module';
import { BillingCycleController } from './billing-cycle.controller';
import { BillingCycleSchedulerService } from './billing-cycle-scheduler.service';
import { BillingCycleService } from './billing-cycle.service';
import { BillingCycle } from './entities/billing-cycle.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BillingCycle, Community, Property]), LovModule, AttributeModule],
  controllers: [BillingCycleController],
  providers: [BillingCycleService, BillingCycleSchedulerService],
  exports: [BillingCycleService],
})
export class BillingCycleModule {}
