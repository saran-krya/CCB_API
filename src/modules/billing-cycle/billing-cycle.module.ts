import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Community } from '../community/entities/community.entity';
import { Property } from '../property/entities/property.entity';
import { LovModule } from '../lov/lov.module';
import { BillingCycleController } from './billing-cycle.controller';
import { BillingCycleService } from './billing-cycle.service';
import { BillingCycle } from './entities/billing-cycle.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BillingCycle, Community, Property]), LovModule],
  controllers: [BillingCycleController],
  providers: [BillingCycleService],
  exports: [BillingCycleService],
})
export class BillingCycleModule {}
